/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Ablauf

   Haelt alles zusammen: Startbildschirm, Warteraum, Partie,
   Aufzeichnung. Der Takt der Simulation (zehnmal je Sekunde)
   ist von der Bildrate getrennt; gezeichnet wird so oft wie
   moeglich und zwischen zwei Schritten geglaettet.
   ═══════════════════════════════════════════════════════════ */
'use strict';

import { Sim } from './sim.js';
import { Welt } from './welt.js';
import { Kamera } from './kamera.js';
import { Steuerung } from './steuerung.js';
import { Hud } from './hud.js';
import { Netz } from './netz.js';
import { Klang } from './klang.js';
import {
  FP, TAKT_MS, RUNDE_TAKTE, GEBAEUDE, EINHEITEN, ZEITALTER, VOELKER, VOLK_LISTE,
  FARBEN, ROHSTOFF_NAME, kosten as kostenVon
} from './regeln.js';
import { KARTEN_ARTEN, KARTEN_GROESSEN } from './karte.js';
import { TECHS } from './regeln.js';

const TECHS_NAME = Object.fromEntries(Object.entries(TECHS).map(([k, v]) => [k, v.name]));

const RUNDE_MS = TAKT_MS * RUNDE_TAKTE;

const Spiel = {
  /* ─────────────── Zustand ─────────────── */
  modus: null,           // 'einzel' | 'mehr' | 'replay'
  sim: null, welt: null, kamera: null, hud: null, steuerung: null,
  netz: new Netz(), klangwerk: new Klang(),
  spielerId: 0, zuschauer: false, blickAuf: 0,
  auswahl: [], bauModus: null, bauStelleJetzt: null,
  offeneBefehle: [], runden: [], naechsteRunde: 0,
  laeuft: false, pausiert: false, tempo: 1,
  aufzeichnung: null, letzterAngriff: null,
  taktAkku: 0, letzteZeit: 0, wartetAufNetz: false,
  raum: null, raumV: 0, lobbyV: 0,

  /* ═══════════════ Startbildschirm ═══════════════ */

  anfang() {
    this.menueFuellen();
    this.menueBinden();
    /* Ist ein Server da? Dann Mehrspieler anbieten. */
    this.netz.erreichbar().then(da => {
      this.serverDa = da;
      const status = document.getElementById('m-status');
      if (!da) status.textContent = 'Kein Server erreichbar — Mehrspieler und Aufzeichnungen brauchen "node server.js". '
        + 'Einzelspiel gegen den Rechner laeuft auch ohne.';
      else this.lobbyLauschen();
    });
  },

  menueFuellen() {
    const volk = document.getElementById('e-volk');
    for (const id of VOLK_LISTE) {
      const o = document.createElement('option');
      o.value = id; o.textContent = VOELKER[id].name;
      volk.appendChild(o);
    }
    const karte = document.getElementById('e-karte');
    for (const id in KARTEN_ARTEN) {
      const o = document.createElement('option');
      o.value = id; o.textContent = KARTEN_ARTEN[id].name;
      karte.appendChild(o);
    }
    const groesse = document.getElementById('e-groesse');
    for (const id in KARTEN_GROESSEN) {
      const o = document.createElement('option');
      o.value = id; o.textContent = KARTEN_GROESSEN[id].name;
      if (id === 'mittel') o.selected = true;
      groesse.appendChild(o);
    }
    const zeigeVolk = () => {
      const v = VOELKER[volk.value];
      document.getElementById('e-volkstext').innerHTML =
        '<b>' + v.name + '</b> — ' + v.beschreibung + '<br>' +
        v.boni.map(b => '• ' + b.text).join('<br>') +
        '<br>• Spezialeinheit aus der Burg: <b>' + EINHEITEN[v.spezial].name + '</b>';
    };
    volk.onchange = zeigeVolk;
    zeigeVolk();
    const name = document.getElementById('m-name');
    name.value = this.netz.name || ('Feldherr ' + (1 + Math.floor(Math.random() * 99)));
  },

  menueBinden() {
    for (const knopf of document.querySelectorAll('.reiter-knopf')) {
      knopf.onclick = () => {
        for (const k of document.querySelectorAll('.reiter-knopf')) k.classList.remove('an');
        knopf.classList.add('an');
        for (const t of document.querySelectorAll('.tafel')) t.classList.add('versteckt');
        document.getElementById('tab-' + knopf.dataset.reiter).classList.remove('versteckt');
        if (knopf.dataset.reiter === 'replay') this.replaysLaden();
      };
    }
    document.getElementById('e-start-knopf').onclick = () => this.einzelStarten();
    document.getElementById('m-neu').onclick = () => this.partieEroeffnen();
    document.getElementById('m-auffrischen').onclick = () => this.lobbyHolen();
    document.getElementById('m-bereit').onclick = () => this.netz.bereit(!this.binIchBereit()).catch(e => this.netzFehler(e));
    document.getElementById('m-starten').onclick = () => this.netz.starten().catch(e => this.netzFehler(e));
    document.getElementById('m-verlassen').onclick = () => this.raumVerlassen();
    document.getElementById('m-chat-eingabe').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      const t = e.target.value.trim();
      if (t) this.netz.chat(t).catch(() => {});
      e.target.value = '';
    };
    document.getElementById('r-auffrischen').onclick = () => this.replaysLaden();
    document.getElementById('r-datei').onchange = (e) => {
      const datei = e.target.files[0];
      if (!datei) return;
      datei.text().then(t => this.replayStarten(JSON.parse(t))).catch(() => alert('Datei nicht lesbar'));
    };
    document.getElementById('k-menue').onclick = () => this.pause();
    document.getElementById('sm-weiter').onclick = () => this.pause(false);
    document.getElementById('sm-aufgeben').onclick = () => { this.senden({ a: 'aufgeben' }); this.pause(false); };
    document.getElementById('sm-replay').onclick = () => this.replaySichern();
    document.getElementById('sm-verlassen').onclick = () => location.reload();
    document.getElementById('ende-zurueck').onclick = () => location.reload();
    globalThis.addEventListener('resize', () => { if (this.welt) this.welt.groesseAnpassen(); });
  },

  /* ═══════════════ Einzelspiel ═══════════════ */

  einzelStarten() {
    const volk = document.getElementById('e-volk').value;
    const gegner = Number(document.getElementById('e-gegner').value);
    const stufe = document.getElementById('e-stufe').value;
    const teams = document.getElementById('e-teams').value;
    const saatText = document.getElementById('e-saat').value.trim();
    const saat = saatText ? (zahlAusText(saatText) | 0) : (Math.random() * 0x7fffffff) | 0;

    const spieler = [{ name: 'Du', volk, team: 0, farbe: 0, ki: null }];
    const uebrige = VOLK_LISTE.filter(v => v !== volk);
    for (let i = 0; i < gegner; i++) {
      spieler.push({
        name: 'Rechner ' + (i + 1),
        volk: uebrige[i % uebrige.length],
        team: teams === 'zwei' ? (i % 2 === 0 ? 1 : 0) : i + 1,
        farbe: i + 1,
        ki: stufe
      });
    }
    const aufbau = {
      saat,
      karte: { art: document.getElementById('e-karte').value, groesse: document.getElementById('e-groesse').value },
      bevGrenze: Number(document.getElementById('e-bev').value),
      startgut: document.getElementById('e-start').value,
      spieler
    };
    this.partieBeginnen('einzel', aufbau, 0);
  },

  /* ═══════════════ Mehrspieler ═══════════════ */

  async anmeldenFallsNoetig() {
    const name = document.getElementById('m-name').value.trim() || 'Feldherr';
    if (!this.netz.token || this.netz.name !== name) await this.netz.anmelden(name);
  },

  async partieEroeffnen() {
    try {
      await this.anmeldenFallsNoetig();
      const a = await this.netz.erstellen({
        name: (this.netz.name || 'Partie') + 's Runde',
        karte: { art: 'ebene', groesse: 'mittel' },
        plaetze: 4, bevGrenze: 100, startgut: 'normal'
      });
      this.raumLauschen(a.partie.id);
    } catch (e) { this.netzFehler(e); }
  },

  async lobbyHolen() {
    try {
      await this.anmeldenFallsNoetig();
      const a = await this.netz.lobby(0);
      this.lobbyZeigen(a.partien);
    } catch (e) { this.netzFehler(e); }
  },

  async lobbyLauschen() {
    /* Langabfrage: der Server antwortet, sobald sich etwas aendert. */
    while (!this.laeuft) {
      try {
        const a = await this.netz.lobby(this.lobbyV);
        this.lobbyV = a.v;
        if (!this.raum) this.lobbyZeigen(a.partien);
      } catch (e) {
        await neueSekunde(2);
      }
    }
  },

  lobbyZeigen(partien) {
    const halter = document.getElementById('m-liste');
    halter.innerHTML = '';
    if (!partien || !partien.length) {
      halter.innerHTML = '<div class="listenzeile"><span class="rest">Noch keine offene Partie. Eroeffne eine!</span></div>';
      return;
    }
    for (const p of partien) {
      const z = document.createElement('div');
      z.className = 'listenzeile';
      z.innerHTML = `<b>${escape(p.name)}</b>
        <span class="rest">${p.belegt}/${p.plaetze} Spieler · ${escape(KARTEN_ARTEN[p.karte.art].name)},
        ${escape(KARTEN_GROESSEN[p.karte.groesse].name)} · ${p.gestartet ? 'laeuft seit ' + Math.round(p.dauer / 60) + ' min' : 'wartet'}
        ${p.zuschauer ? '· ' + p.zuschauer + ' Zuschauer' : ''}</span>`;
      const knopf = document.createElement('button');
      knopf.className = 'knopf';
      knopf.textContent = p.gestartet ? 'Zusehen' : 'Beitreten';
      knopf.onclick = async () => {
        try {
          await this.anmeldenFallsNoetig();
          const a = await this.netz.beitreten(p.id, p.gestartet);
          if (a.partie.gestartet) this.zuschauenStarten(a.partie);
          else this.raumLauschen(p.id);
        } catch (e) { this.netzFehler(e); }
      };
      z.appendChild(knopf);
      halter.appendChild(z);
    }
  },

  async raumLauschen(id) {
    this.raum = { id };
    this.raumV = 0;
    document.getElementById('m-raum').classList.remove('versteckt');
    while (this.raum && !this.laeuft) {
      try {
        const a = await this.netz.raum(id, this.raumV);
        if (!this.raum) break;
        this.raumV = a.v;
        this.raum = a.partie;
        if (a.partie.gestartet) { this.mehrspielerStarten(a.partie); break; }
        this.raumZeigen(a.partie);
      } catch (e) {
        if (!this.raum) break;
        await neueSekunde(2);
      }
    }
  },

  raumZeigen(partie) {
    document.getElementById('m-raum-titel').textContent = 'Warteraum: ' + partie.name;
    const halter = document.getElementById('m-plaetze');
    halter.innerHTML = '';
    const binWirt = partie.wirt === this.netz.spielerId || partie.wirtToken === true;
    partie.plaetze.forEach((pl, i) => {
      const z = document.createElement('div');
      z.className = 'platz';
      const farbe = FARBEN[i % FARBEN.length];
      const meins = pl.ich;
      z.innerHTML = `<span class="farbfleck" style="background:#${farbe.hex.toString(16).padStart(6, '0')}"></span>
        <span class="name">${escape(pl.name || (pl.ki ? 'Rechner (' + pl.ki + ')' : 'frei'))}</span>`;
      if (meins || (binWirt && pl.ki)) {
        const volk = document.createElement('select');
        for (const v of VOLK_LISTE) {
          const o = document.createElement('option');
          o.value = v; o.textContent = VOELKER[v].name;
          if (pl.volk === v) o.selected = true;
          volk.appendChild(o);
        }
        volk.onchange = () => this.netz.platz('volk', { platz: i, wert: volk.value }).catch(() => {});
        z.appendChild(volk);
        const team = document.createElement('select');
        for (let t = 1; t <= 4; t++) {
          const o = document.createElement('option');
          o.value = t; o.textContent = 'Team ' + t;
          if (pl.team === t) o.selected = true;
          team.appendChild(o);
        }
        team.onchange = () => this.netz.platz('team', { platz: i, wert: Number(team.value) }).catch(() => {});
        z.appendChild(team);
      } else {
        const t = document.createElement('span');
        t.textContent = (pl.volk ? VOELKER[pl.volk].name : '') + (pl.team ? ' · Team ' + pl.team : '');
        z.appendChild(t);
      }
      if (binWirt && !pl.ich) {
        const ki = document.createElement('select');
        for (const [wert, text] of [['', 'Mensch'], ['leicht', 'Rechner leicht'], ['normal', 'Rechner normal'], ['schwer', 'Rechner schwer'], ['zu', 'Platz zu']]) {
          const o = document.createElement('option');
          o.value = wert; o.textContent = text;
          if ((pl.ki || (pl.zu ? 'zu' : '')) === wert) o.selected = true;
          ki.appendChild(o);
        }
        ki.onchange = () => this.netz.platz('art', { platz: i, wert: ki.value }).catch(() => {});
        z.appendChild(ki);
      }
      if (pl.bereit) {
        const b = document.createElement('span');
        b.className = 'bereit'; b.textContent = '✓ bereit';
        z.appendChild(b);
      }
      halter.appendChild(z);
    });

    /* Einstellungen darf nur der Wirt aendern. */
    const e = document.getElementById('m-einstellungen');
    e.innerHTML = '';
    const feld = (beschriftung, feldName, werte, jetzt) => {
      const l = document.createElement('label');
      l.textContent = beschriftung;
      const s = document.createElement('select');
      for (const [wert, text] of werte) {
        const o = document.createElement('option');
        o.value = wert; o.textContent = text;
        if (String(jetzt) === String(wert)) o.selected = true;
        s.appendChild(o);
      }
      s.disabled = !binWirt;
      s.onchange = () => this.netz.einstellung(feldName, s.value).catch(() => {});
      l.appendChild(s);
      e.appendChild(l);
    };
    feld('Karte', 'kartenart', Object.entries(KARTEN_ARTEN).map(([k, v]) => [k, v.name]), partie.karte.art);
    feld('Groesse', 'kartengroesse', Object.entries(KARTEN_GROESSEN).map(([k, v]) => [k, v.name]), partie.karte.groesse);
    feld('Bevoelkerung', 'bevGrenze', [[50, '50'], [100, '100'], [200, '200']], partie.bevGrenze);
    feld('Startgut', 'startgut', [['normal', 'Normal'], ['reich', 'Reich']], partie.startgut);

    document.getElementById('m-starten').style.display = binWirt ? '' : 'none';
    document.getElementById('m-bereit').textContent = this.binIchBereit() ? 'Doch nicht bereit' : 'Bereit';
    const chat = document.getElementById('m-chat');
    chat.innerHTML = (partie.chat || []).map(c => `<div><b>${escape(c.name)}:</b> ${escape(c.text)}</div>`).join('');
    chat.scrollTop = chat.scrollHeight;
  },

  binIchBereit() {
    if (!this.raum || !this.raum.plaetze) return false;
    const meiner = this.raum.plaetze.find(p => p.ich);
    return !!(meiner && meiner.bereit);
  },

  raumVerlassen() {
    this.netz.verlassen().catch(() => {});
    this.netz.alleAbbrechen();
    this.raum = null;
    document.getElementById('m-raum').classList.add('versteckt');
    this.lobbyLauschen();
  },

  mehrspielerStarten(partie) {
    const spieler = partie.plaetze.filter(p => !p.zu).map((p, i) => ({
      name: p.name || ('Rechner ' + (i + 1)),
      volk: p.volk, team: p.team, farbe: i, ki: p.ki || null
    }));
    const meinPlatz = partie.plaetze.filter(p => !p.zu).findIndex(p => p.ich);
    const aufbau = {
      saat: partie.saat,
      karte: partie.karte,
      bevGrenze: partie.bevGrenze,
      startgut: partie.startgut,
      spieler
    };
    this.partieId = partie.id;
    this.partieBeginnen('mehr', aufbau, meinPlatz >= 0 ? meinPlatz : null);
  },

  zuschauenStarten(partie) {
    this.mehrspielerStarten(Object.assign({}, partie, {
      plaetze: partie.plaetze.map(p => Object.assign({}, p, { ich: false }))
    }));
  },

  /* ═══════════════ Aufzeichnungen ═══════════════ */

  async replaysLaden() {
    const halter = document.getElementById('r-liste');
    halter.innerHTML = '<div class="listenzeile"><span class="rest">wird geladen …</span></div>';
    try {
      const a = await this.netz.replays();
      halter.innerHTML = '';
      if (!a.replays.length) {
        halter.innerHTML = '<div class="listenzeile"><span class="rest">Noch nichts aufgezeichnet.</span></div>';
        return;
      }
      for (const r of a.replays) {
        const z = document.createElement('div');
        z.className = 'listenzeile';
        z.innerHTML = `<b>${escape(r.name)}</b><span class="rest">${escape(r.spieler.join(', '))} ·
          ${Math.round(r.dauer / 60)} min · ${new Date(r.zeit).toLocaleString('de-DE')}</span>`;
        const knopf = document.createElement('button');
        knopf.className = 'knopf'; knopf.textContent = 'Ansehen';
        knopf.onclick = async () => {
          try { this.replayStarten((await this.netz.replay(r.id)).replay); }
          catch (e) { this.netzFehler(e); }
        };
        z.appendChild(knopf);
        halter.appendChild(z);
      }
    } catch (e) {
      halter.innerHTML = '<div class="listenzeile"><span class="rest">Kein Server erreichbar.</span></div>';
    }
  },

  replayStarten(daten) {
    if (!daten || !daten.aufbau) { alert('Aufzeichnung unlesbar'); return; }
    this.runden = daten.runden || [];
    this.partieBeginnen('replay', daten.aufbau, null);
  },

  replaySichern() {
    if (!this.aufzeichnung) return;
    const daten = JSON.stringify(this.aufzeichnung);
    const blob = new Blob([daten], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aufzeichnung-' + this.aufzeichnung.aufbau.saat + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    if (this.serverDa) this.netz.replaySichern(this.aufzeichnung).catch(() => {});
    this.hinweis('Aufzeichnung gesichert');
  },

  /* ═══════════════ Partie ═══════════════ */

  partieBeginnen(modus, aufbau, spielerId) {
    this.modus = modus;
    this.netz.alleAbbrechen();
    this.raum = null;
    document.getElementById('menue').classList.add('versteckt');
    document.getElementById('spiel').classList.remove('versteckt');

    this.sim = new Sim(aufbau);
    this.spielerId = spielerId == null ? null : spielerId;
    this.zuschauer = spielerId == null;
    this.blickAuf = 0;
    this.auswahl = [];
    this.offeneBefehle = [];
    this.naechsteRunde = 0;
    this.taktAkku = 0;
    this.letzteZeit = performance.now();
    this.pausiert = false;
    this.aufzeichnung = {
      aufbau,
      runden: modus === 'replay' ? this.runden : [],
      name: aufbau.spieler.map(p => p.name).join(' gegen '),
      zeit: Date.now()
    };
    if (modus !== 'replay') this.runden = [];

    const leinwand = document.getElementById('leinwand');
    this.welt = new Welt(this.sim, leinwand, this.zuschauer ? null : spielerId);
    this.kamera = new Kamera(this.welt);
    this.hud = new Hud(this);
    this.steuerung = new Steuerung(this);
    this.welt.groesseAnpassen();

    /* Blick auf das eigene Dorf. */
    const meiner = this.sim.spieler[this.zuschauer ? 0 : spielerId];
    this.kamera.zentriere(meiner.startX + 0.5, meiner.startY + 4);

    this.laeuft = true;
    if (modus === 'mehr') {
      this.rundenLauschen();
      this.sendeUhr = setInterval(() => this.befehleAbschicken(), 100);
    }
    this.hud.meldung('Dunkle Zeit — bau dein Dorf auf.', 'gut');
    if (modus === 'replay') this.hud.meldung('Aufzeichnung: ' + this.aufzeichnung.name);
    requestAnimationFrame(t => this.schleife(t));
  },

  /* ─────────────── Schleife ───────────────
     Die Simulation laeuft in festen Schritten von 100 ms, das Bild
     so oft wie moeglich. Zwischen zwei Schritten wird die Bewegung
     geglaettet — sonst wuerde alles ruckeln. */

  schleife(t) {
    if (!this.laeuft) return;
    const dt = Math.min(250, t - this.letzteZeit || 16);
    this.letzteZeit = t;

    this.kamera.aktualisiere(dt / 1000);

    if (!this.pausiert) {
      /* Rueckstand: Zuschauer und Wiedereinsteiger fangen bei Runde
         null an und muessen erst zur Gegenwart aufschliessen. Dann
         wird im Schnelldurchlauf gerechnet, statt in Echtzeit. */
      const rueckstand = this.modus === 'einzel' ? 0
        : this.runden.length - Math.floor(this.sim.takt / RUNDE_TAKTE);
      const holtAuf = rueckstand > 12;
      const grenze = holtAuf ? 400 : 10;
      if (holtAuf) this.taktAkku = TAKT_MS * grenze;
      else this.taktAkku += dt * this.tempo;

      let schritte = 0;
      while (this.taktAkku >= TAKT_MS && schritte < grenze) {
        if (!this.taktSchritt()) break;
        this.taktAkku -= TAKT_MS;
        schritte++;
      }
      if (this.taktAkku > TAKT_MS * 10) this.taktAkku = TAKT_MS;
      if (holtAuf) {
        this.taktAkku = 0;
        if (!this.holteAufUhr || t - this.holteAufUhr > 900) {
          this.holteAufUhr = t;
          this.hud.hinweis('hole auf … noch ' + Math.round(rueckstand * RUNDE_MS / 1000) + ' Sekunden');
        }
      }
    }

    this.welt.setzeAuswahl(this.auswahl);
    this.welt.zeichne(this.taktAkku / TAKT_MS);

    this.hud.aktualisiere();
    if (!this.minikarteUhr || t - this.minikarteUhr > 120) {
      this.minikarteUhr = t;
      this.hud.minikarteZeichnen();
    }
    requestAnimationFrame(z => this.schleife(z));
  },

  /** Ein Simulationsschritt. Gibt false zurueck, wenn auf Befehle gewartet wird. */
  taktSchritt() {
    const sim = this.sim;
    if (sim.vorbei && !this.endeGezeigt) { this.endeZeigen(); return false; }
    if (sim.takt % RUNDE_TAKTE === 0) {
      const nr = sim.takt / RUNDE_TAKTE;
      let befehle;
      if (this.modus === 'einzel') {
        befehle = this.offeneBefehle;
        this.offeneBefehle = [];
        this.aufzeichnung.runden.push(befehle);
      } else if (this.modus === 'replay') {
        if (nr >= this.runden.length) {
          if (!this.replayEnde) { this.replayEnde = true; this.hud.meldung('Ende der Aufzeichnung', 'gut'); }
          return false;
        }
        befehle = this.runden[nr];
      } else {
        befehle = this.runden[nr];
        if (!befehle) {
          if (!this.wartetAufNetz) { this.wartetAufNetz = true; this.hud.hinweis('warte auf Mitspieler …'); }
          return false;
        }
        this.wartetAufNetz = false;
        this.aufzeichnung.runden.push(befehle);
        if (nr % 100 === 0 && nr > 0) {
          this.netz.pruefsumme(nr, sim.pruefsumme()).catch(() => {});
        }
      }
      sim.befehleAnwenden(befehle);
    }
    sim.takten();
    this.ereignisseVerarbeiten();
    if (sim.takt % 5 === 0) this.welt.nebelDreckig = true;
    return true;
  },

  /* ─────────────── Befehle ─────────────── */

  senden(befehl) {
    if (this.zuschauer || this.modus === 'replay') return;
    befehl.s = this.spielerId;
    if (this.modus === 'einzel') this.offeneBefehle.push(befehl);
    else this.offeneBefehle.push(befehl);   // wird gesammelt verschickt
  },

  befehleAbschicken() {
    if (this.modus !== 'mehr' || this.zuschauer) return;
    if (!this.offeneBefehle.length) return;
    const liste = this.offeneBefehle;
    this.offeneBefehle = [];
    this.netz.befehle(0, liste).catch(() => {
      /* Verloren gegangene Befehle nicht wiederholen: sie wuerden in
         einer spaeteren Runde landen und alle anderen haetten sie
         nicht. Lieber einmal verschluckt als auseinandergelaufen. */
      this.hud.hinweis('Befehl ging verloren');
    });
  },

  async rundenLauschen() {
    while (this.laeuft && this.modus === 'mehr') {
      try {
        const a = await this.netz.runden(this.runden.length);
        if (a.runden) {
          for (let i = 0; i < a.runden.length; i++) {
            this.runden[a.ab + i] = a.runden[i];
          }
        }
        if (a.vorbei && !this.sim.vorbei) {
          /* Partie wurde serverseitig beendet (alle weg). */
          this.hud.meldung('Die Partie wurde beendet.', 'warnung');
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }
  },

  /* ─────────────── Auswahl ─────────────── */

  setzeAuswahl(ids, dazu) {
    const sim = this.sim;
    let neu = (ids || []).filter(id => {
      const o = sim.nachId.get(id);
      return o && !o.tot;
    });
    if (dazu) {
      const menge = new Set(this.auswahl);
      for (const id of neu) menge.add(id);
      neu = [...menge];
    }
    /* Eigene Einheiten haben Vorrang: sind welche dabei, fliegen
       fremde und Gebaeude raus — sonst wird der Rechtsklick wirr. */
    const eigeneEinheiten = neu.filter(id => {
      const o = sim.nachId.get(id);
      return o.art === 'einheit' && o.spieler === this.spielerId;
    });
    if (eigeneEinheiten.length) neu = eigeneEinheiten;
    else if (neu.length > 1) neu = [neu[0]];
    this.auswahl = neu.slice(0, 60);
    if (this.auswahl.length) this.klang('auswahl');
    if (this.bauModus && !this.auswahl.length) this.bauAbbrechen();
  },

  /** Zuschauer sehen die Rohstoffe reihum bei jedem Spieler. */
  blickWechseln() {
    if (!this.zuschauer) return;
    this.blickAuf = (this.blickAuf + 1) % this.sim.spieler.length;
    const p = this.sim.spieler[this.blickAuf];
    this.hud.hinweis('Sicht: ' + p.name + ' (' + VOELKER[p.volk].name + ')');
    this.kamera.zentriere(p.startX, p.startY);
  },

  zurAuswahl() {
    const o = this.sim.nachId.get(this.auswahl[0]);
    if (!o) return;
    this.kamera.zentriere(o.art === 'gebaeude' ? o.kx + o.groesse / 2 : o.x / FP,
                          o.art === 'gebaeude' ? o.ky + o.groesse / 2 : o.y / FP);
  },

  zumDorfzentrum() {
    if (this.zuschauer) return;
    for (const b of this.sim.gebaeude) {
      if (b.tot || b.spieler !== this.spielerId || b.typ !== 'dorfzentrum') continue;
      this.setzeAuswahl([b.id]);
      this.kamera.zentriere(b.kx + b.groesse / 2, b.ky + b.groesse / 2);
      return;
    }
  },

  naechsterUntaetiger() {
    if (this.zuschauer) return;
    const liste = this.sim.untaetigeDorfbewohner(this.spielerId);
    if (!liste.length) { this.hinweis('Alle Dorfbewohner haben Arbeit'); return; }
    this.untaetigZaehler = ((this.untaetigZaehler || 0) + 1) % liste.length;
    const e = liste[this.untaetigZaehler];
    this.setzeAuswahl([e.id]);
    this.kamera.zentriere(e.x / FP, e.y / FP);
  },

  zumLetztenEreignis() {
    if (!this.letzterAngriff) { this.hinweis('Nichts Neues'); return; }
    this.kamera.zentriere(this.letzterAngriff.x, this.letzterAngriff.y);
  },

  abreissen() {
    if (this.zuschauer) return;
    const ids = this.auswahl.filter(id => {
      const o = this.sim.nachId.get(id);
      return o && o.art === 'gebaeude' && o.spieler === this.spielerId;
    });
    if (ids.length) this.senden({ a: 'abreissen', ids });
  },

  /* ─────────────── Bauen ─────────────── */

  bauStarten(typ) {
    if (this.zuschauer) return;
    this.bauModus = typ;
    this.hinweis(GEBAEUDE[typ].name + ' setzen — rechte Taste bricht ab');
  },

  bauAbbrechen() {
    this.bauModus = null;
    this.welt.zeigeVorschau(null);
  },

  bauStelle(p) {
    const typ = this.bauModus;
    if (!typ) return null;
    const punkt = this.welt.bodenPunkt(p.x, p.y);
    if (!punkt) return null;
    const g = GEBAEUDE[typ].groesse;
    const kx = Math.round(punkt.x - g / 2);
    const ky = Math.round(punkt.z - g / 2);
    const kosten = kostenVon('gebaeude', typ, this.sim.spieler[this.spielerId].volk);
    const gueltig = this.sim.bauplatzFrei(this.spielerId, typ, kx, ky)
                 && this.sim.kannZahlen(this.spielerId, kosten);
    return { kx, ky, gueltig };
  },

  bauVorschau(p) {
    const stelle = this.bauStelle(p);
    if (!stelle) { this.welt.zeigeVorschau(null); return; }
    this.welt.zeigeVorschau(this.bauModus, stelle.kx, stelle.ky, stelle.gueltig,
      this.sim.spieler[this.spielerId].volk);
  },

  bauAusfuehren(typ, stelle, reihe, weiter) {
    const bauer = this.auswahl.filter(id => {
      const o = this.sim.nachId.get(id);
      return o && o.art === 'einheit' && o.spieler === this.spielerId && this.sim.werte(o.spieler, o.typ).kannBauen;
    });
    if (!bauer.length) { this.hinweis('Dafuer brauchst du Dorfbewohner'); this.bauAbbrechen(); return; }
    if (!stelle.gueltig) { this.hinweis('Hier ist kein Platz'); this.klang('fehlt'); return; }
    this.senden({ a: 'bauen', ids: bauer, typ, kx: stelle.kx, ky: stelle.ky, reihe: reihe || null });
    this.klang('befehl');
    if (!weiter) this.bauAbbrechen();
  },

  /* ─────────────── Rueckmeldungen ─────────────── */

  ereignisseVerarbeiten() {
    const sim = this.sim;
    if (!sim.ereignisse.length) return;
    const meiner = this.spielerId;
    for (const e of sim.ereignisse) {
      switch (e.art) {
        case 'gebaeudeFertig':
          if (e.spieler === meiner) { this.klang('gebaeude'); this.hud.meldung(GEBAEUDE[e.typ].name + ' fertiggestellt', 'gut'); }
          break;
        case 'einheitFertig':
          if (e.spieler === meiner) this.klang('einheit');
          break;
        case 'techFertig':
          if (e.spieler === meiner) this.hud.meldung('Erforscht: ' + (TECHS_NAME[e.tech] || e.tech), 'gut');
          break;
        case 'zeitalterFertig':
          if (e.spieler === meiner) { this.klang('zeitalter'); this.hud.meldung('Du erreichst die ' + ZEITALTER[e.zeitalter].name + '!', 'gut'); }
          else this.hud.meldung(sim.spieler[e.spieler].name + ' erreicht die ' + ZEITALTER[e.zeitalter].name);
          break;
        case 'fehlt':
          if (e.spieler === meiner) { this.hinweis('Es fehlt ' + (ROHSTOFF_NAME[e.rohstoff] || 'etwas')); this.klang('fehlt'); }
          break;
        case 'bevVoll':
          if (e.spieler === meiner) this.hinweis('Bevoelkerungsgrenze — bau Haeuser');
          break;
        case 'meldung':
          if (e.spieler === meiner) this.hinweis(e.text);
          break;
        case 'einheitTot':
          if (e.spieler === meiner) {
            this.letzterAngriff = { x: e.x / FP, y: e.y / FP };
            if (!this.angriffUhr || performance.now() - this.angriffUhr > 8000) {
              this.angriffUhr = performance.now();
              this.hud.meldung('Deine Einheiten werden angegriffen!', 'warnung');
              this.klang('angriff');
            }
          }
          break;
        case 'gebaeudeWeg':
          if (e.spieler === meiner) {
            this.letzterAngriff = { x: e.x / FP, y: e.y / FP };
            this.hud.meldung(GEBAEUDE[e.typ].name + ' verloren', 'warnung');
          }
          break;
        case 'quelleLeer':
          this.welt.landDreckig = true;
          break;
        case 'farmLeer':
          if (e.spieler === meiner) this.hud.meldung('Eine Farm ist abgeerntet');
          break;
        case 'hieb': case 'schuss': case 'treffer': case 'einschlag': case 'abgabe':
          if (this.nahAmBild(e.x, e.y)) this.klang(e.art);
          break;
        case 'bekehrt':
          if (e.spieler === meiner) this.hud.meldung('Eine Einheit ist uebergelaufen', 'gut');
          break;
        case 'besiegt':
          this.hud.meldung(sim.spieler[e.spieler].name + ' ist besiegt (' + e.grund + ')',
            e.spieler === meiner ? 'warnung' : 'gut');
          break;
        case 'partieEnde':
          this.endeZeigen();
          break;
      }
    }
  },

  nahAmBild(x, y) {
    if (!this.kamera) return false;
    const dx = x / FP - this.kamera.ziel.x, dz = y / FP - this.kamera.ziel.z;
    return dx * dx + dz * dz < 900;
  },

  zeigeBefehlspunkt(punkt) {
    this.welt.zeigeFahne({ x: punkt.x, z: punkt.z }, 0xffe08a);
    clearTimeout(this.fahnenUhr);
    this.fahnenUhr = setTimeout(() => this.welt.zeigeFahne(null), 900);
  },

  hinweis(text) { if (this.hud) this.hud.hinweis(text); },
  klang(art) { if (this.klangwerk) this.klangwerk.spiele(art); },
  rahmen(r) { if (this.hud) this.hud.rahmen(r); },

  pause(an) {
    if (this.modus === 'mehr') {
      /* Im Mehrspieler kann niemand die Zeit anhalten. */
      const m = document.getElementById('spielmenue');
      m.classList.toggle('versteckt', an === false ? true : !m.classList.contains('versteckt') ? true : false);
      return;
    }
    const m = document.getElementById('spielmenue');
    const zeigen = an == null ? m.classList.contains('versteckt') : an;
    m.classList.toggle('versteckt', !zeigen);
    this.pausiert = zeigen;
  },

  /* ─────────────── Ende ─────────────── */

  endeZeigen() {
    if (this.endeGezeigt) return;
    this.endeGezeigt = true;
    const sim = this.sim;
    const meiner = this.zuschauer ? null : sim.spieler[this.spielerId];
    const gewonnen = meiner && !meiner.besiegt && sim.sieger === meiner.team;
    document.getElementById('ende-titel').textContent =
      this.zuschauer ? 'Partie beendet'
      : (gewonnen ? 'Sieg!' : 'Niederlage');
    this.klang(gewonnen ? 'sieg' : 'niederlage');

    const tafel = document.getElementById('ende-tafel');
    tafel.innerHTML = '';
    for (const p of sim.spieler) {
      const st = p.statistik;
      const gesamt = st.gesammelt.nahrung + st.gesammelt.holz + st.gesammelt.gold + st.gesammelt.stein;
      const z = document.createElement('div');
      z.className = 'ende-zeile' + (sim.sieger === p.team ? ' sieger' : '');
      z.innerHTML = `<span>${escape(p.name)} (${escape(VOELKER[p.volk].name)}, Team ${p.team + 1})</span>
        <span>${ZEITALTER[p.zeitalter].kurz} · ${gesamt} Rohstoffe · ${st.getoetet} besiegt · ${st.gebaut} Bauten</span>`;
      tafel.appendChild(z);
    }
    document.getElementById('ende').classList.remove('versteckt');
    if (this.modus !== 'replay' && this.serverDa) {
      this.netz.replaySichern(this.aufzeichnung).catch(() => {});
    }
  },

  netzFehler(e) {
    document.getElementById('m-status').textContent = 'Fehler: ' + (e && e.message ? e.message : e);
  }
};

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function zahlAusText(t) {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0;
  return h || 1;
}
function neueSekunde(n) { return new Promise(r => setTimeout(r, n * 1000)); }

globalThis.__spiel = Spiel;   /* fuer Fehlersuche in der Konsole */
Spiel.anfang();

export default Spiel;
