/* ═══════════════════════════════════════════════════════════
   AGE OF GENERATION — Bedienoberflaeche

   Rohstoffleiste, Auswahlfeld, Aktionsknoepfe, Minikarte und
   Meldungen. Alles gewoehnliches HTML ueber der Zeichenflaeche —
   dadurch bleibt es mit der Tastatur bedienbar und kostet keine
   Bildrate.
   ═══════════════════════════════════════════════════════════ */
'use strict';

import {
  FP, GEBAEUDE, EINHEITEN, TECHS, ZEITALTER, FARBEN, ROHSTOFFE, ROHSTOFF_NAME,
  BODEN, kosten as kostenVon, aufstiegKosten, kostenText, spezialEinheit, HANDEL
} from './regeln.js';
import { VORKOMMEN_LISTE } from './karte.js';

const BODENFARBE_MINI = {
  [BODEN.gras]: [95, 140, 60], [BODEN.wiese]: [116, 160, 74], [BODEN.sand]: [203, 182, 129],
  [BODEN.fels]: [139, 139, 133], [BODEN.wasser]: [47, 109, 140], [BODEN.acker]: [138, 106, 58],
  [BODEN.strasse]: [168, 155, 128]
};

export class Hud {
  constructor(spiel) {
    this.spiel = spiel;
    this.sim = spiel.sim;
    this.el = {
      nahrung: document.getElementById('r-nahrung'),
      holz: document.getElementById('r-holz'),
      gold: document.getElementById('r-gold'),
      stein: document.getElementById('r-stein'),
      bev: document.getElementById('r-bev'),
      zeitalter: document.getElementById('k-zeitalter'),
      uhr: document.getElementById('k-uhr'),
      auswahlKopf: document.getElementById('auswahl-kopf'),
      auswahlListe: document.getElementById('auswahl-liste'),
      knoepfe: document.getElementById('knoepfe'),
      meldungen: document.getElementById('meldungen'),
      hinweis: document.getElementById('hinweis'),
      minikarte: document.getElementById('minikarte'),
      rahmen: document.getElementById('rahmen')
    };
    this.mk = this.el.minikarte.getContext('2d');
    this.letzteKnoepfe = '';
    this.letzteAuswahl = '';
    this.hinweisUhr = 0;
    this.minikarteVorbereiten();
    this.minikarteBinden();
  }

  /* ─────────────── Kopfleiste ─────────────── */

  aktualisiere() {
    const sim = this.sim;
    const p = this.spiel.zuschauer ? sim.spieler[this.spiel.blickAuf || 0] : sim.spieler[this.spiel.spielerId];
    if (p) {
      for (const r of ROHSTOFFE) this.el[r].textContent = Math.floor(p.rohstoffe[r]);
      const bev = sim.bevoelkerung(p.id);
      this.el.bev.textContent = bev.jetzt + '/' + bev.raum;
      this.el.bev.style.color = bev.jetzt >= bev.raum ? '#e8a33a' : '';
      this.el.zeitalter.textContent = ZEITALTER[p.zeitalter].name;
    }
    const s = sim.zeit();
    this.el.uhr.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    this.auswahlZeigen();
    if (this.hinweisUhr && performance.now() > this.hinweisUhr) {
      this.el.hinweis.classList.remove('an');
      this.hinweisUhr = 0;
    }
  }

  /* ─────────────── Auswahl ─────────────── */

  auswahlZeigen() {
    const sim = this.sim;
    const liste = this.spiel.auswahl.map(id => sim.nachId.get(id)).filter(o => o && !o.tot);
    const stempel = liste.map(o => o.id + ':' + Math.round(o.hp) + ':' + (o.warteschlange ? o.warteschlange.length + ':' + (o.warteschlange[0] ? o.warteschlange[0].rest : 0) : '') + ':' + (o.fertig === false ? o.bauFortschritt : '')).join(',')
      + '|' + (this.spiel.spielerId != null ? sim.spieler[this.spiel.spielerId].zeitalter : '');
    if (stempel === this.letzteAuswahl) return;
    this.letzteAuswahl = stempel;

    if (!liste.length) {
      this.el.auswahlKopf.textContent = '';
      this.el.auswahlListe.innerHTML = '';
      this.knoepfeBauen(null);
      return;
    }
    const erstes = liste[0];
    const p = sim.spieler[erstes.spieler];
    const eigen = erstes.spieler === this.spiel.spielerId;

    if (liste.length === 1) {
      const name = erstes.art === 'gebaeude'
        ? GEBAEUDE[erstes.typ].name
        : sim.werte(erstes.spieler, erstes.typ).name;
      let werte = `${Math.ceil(erstes.hp)}/${erstes.hpMax} TP · ${p.name} (${p.volk})`;
      if (erstes.art === 'einheit') {
        const w = sim.werte(erstes.spieler, erstes.typ);
        if (w.schaden) werte += ` · ${w.schaden} Schaden`;
        if (w.reichweite >= 1) werte += ` · Reichweite ${w.reichweite}`;
        werte += ` · Ruestung ${w.ruestungNah}/${w.ruestungFern}`;
        if (erstes.ladung) werte += ` · traegt ${erstes.ladung} ${ROHSTOFF_NAME[erstes.ladungArt]}`;
        if (EINHEITEN[erstes.typ].plaetze) {
          werte += ` · an Bord ${erstes.fracht ? erstes.fracht.length : 0}/${EINHEITEN[erstes.typ].plaetze}`;
        }
      } else {
        const def = GEBAEUDE[erstes.typ];
        if (!erstes.fertig) werte += ` · im Bau ${Math.round(erstes.bauFortschritt * 100 / erstes.bauGesamt)} %`;
        if (def.acker && erstes.vorrat) werte += ` · Vorrat ${erstes.vorrat}`;
        if (def.beschreibung) werte += `\n${def.beschreibung}`;
      }
      this.el.auswahlKopf.innerHTML = `${escape(name)}<span class="werte">${escape(werte)}</span>`;
      this.el.auswahlListe.innerHTML = '';
    } else {
      const nachTyp = new Map();
      for (const o of liste) nachTyp.set(o.typ, (nachTyp.get(o.typ) || 0) + 1);
      this.el.auswahlKopf.innerHTML = `${liste.length} ausgewaehlt<span class="werte">${
        [...nachTyp].map(([t, n]) => n + '× ' + (EINHEITEN[t] ? sim.werte(erstes.spieler, t).name : GEBAEUDE[t].name)).join(', ')
      }</span>`;
      this.el.auswahlListe.innerHTML = '';
      for (const o of liste.slice(0, 40)) {
        const k = document.createElement('button');
        k.className = 'einheitknopf';
        const name = o.art === 'gebaeude' ? GEBAEUDE[o.typ].name : sim.werte(o.spieler, o.typ).name;
        k.innerHTML = `<span>${escape(name.slice(0, 8))}</span><span class="lebensbalken"><i style="width:${Math.round(o.hp * 100 / o.hpMax)}%"></i></span>`;
        k.title = name;
        k.onclick = (ev) => this.spiel.setzeAuswahl([o.id], ev.shiftKey);
        this.el.auswahlListe.appendChild(k);
      }
    }
    this.knoepfeBauen(eigen ? liste : null);
  }

  /* ─────────────── Aktionsknoepfe ─────────────── */

  knoepfeBauen(liste) {
    const sim = this.sim;
    const halter = this.el.knoepfe;
    halter.innerHTML = '';
    if (!liste || !liste.length || this.spiel.zuschauer) return;
    const p = sim.spieler[this.spiel.spielerId];
    const bauer = liste.filter(o => o.art === 'einheit' && sim.werte(o.spieler, o.typ).kannBauen);
    const einheiten = liste.filter(o => o.art === 'einheit');
    const gebaeude = liste.filter(o => o.art === 'gebaeude');

    const knopf = (o) => {
      const b = document.createElement('button');
      b.className = 'aktion';
      b.innerHTML = `<span class="taste">${o.taste || ''}</span>
        <span class="form ${o.form || ''}"></span>
        <span>${escape(o.name)}</span>
        ${o.kosten ? `<span class="kosten">${escape(o.kosten)}</span>` : ''}`;
      b.title = o.titel || o.name;
      if (o.gesperrt) b.disabled = true;
      else b.onclick = o.tun;
      if (o.fortschritt != null) {
        const f = document.createElement('span');
        f.className = 'fortschritt';
        f.style.width = Math.round(o.fortschritt * 100) + '%';
        b.appendChild(f);
      }
      halter.appendChild(b);
      return b;
    };

    /* Dorfbewohner → Baumenue */
    if (bauer.length) {
      for (const typ in GEBAEUDE) {
        const def = GEBAEUDE[typ];
        if (def.zeitalter > p.zeitalter) continue;
        const k = kostenVon('gebaeude', typ, p.volk);
        const fehlt = !sim.kannZahlen(p.id, k);
        const braucht = def.braucht && !sim.hatGebaeude(p.id, def.braucht);
        knopf({
          name: def.name, taste: def.taste, kosten: kurzKosten(k),
          form: typ === 'haus' ? 'haus' : (typ === 'turm' || typ === 'burg' ? 'turm'
                : (typ === 'mauer' || typ === 'tor' ? 'mauer' : (def.acker ? 'acker' : ''))),
          titel: def.name + ' — ' + kostenText(k) + '\n' + (def.beschreibung || '')
                 + (braucht ? '\nBraucht zuerst: ' + GEBAEUDE[def.braucht].name : ''),
          gesperrt: fehlt || braucht,
          tun: () => this.spiel.bauStarten(typ)
        });
      }
      knopf({ name: 'Anhalten', taste: 'S', form: 'einheit',
        tun: () => this.spiel.senden({ a: 'stopp', ids: einheiten.map(o => o.id) }) });
      return;
    }

    /* Gebaeude → Ausbildung, Forschung, Zeitalter */
    if (gebaeude.length) {
      const b = gebaeude[0];
      const def = GEBAEUDE[b.typ];
      if (!b.fertig) {
        knopf({ name: 'Abreissen', taste: 'Entf', form: 'mauer',
          tun: () => this.spiel.senden({ a: 'abreissen', ids: [b.id] }) });
        return;
      }
      for (const typ of (def.produziert || [])) {
        const echt = typ === 'spezial' ? spezialEinheit(p.volk) : typ;
        const ed = EINHEITEN[echt];
        if (!ed) continue;
        const k = kostenVon('einheit', echt, p.volk);
        const zuFrueh = ed.zeitalter > p.zeitalter;
        knopf({
          name: sim.werte(p.id, echt).name, taste: ed.taste, kosten: kurzKosten(k), form: 'einheit',
          titel: ed.name + ' — ' + kostenText(k) + '\n' + (ed.beschreibung || '')
                 + (zuFrueh ? '\nErst ab ' + ZEITALTER[ed.zeitalter].name : ''),
          gesperrt: zuFrueh || !sim.kannZahlen(p.id, k),
          tun: (ev) => this.spiel.senden({ a: 'ausbilden', g: b.id, typ, anzahl: ev && ev.shiftKey ? 5 : 1 })
        });
      }
      for (const t of (def.forscht || [])) {
        const td = TECHS[t];
        if (!td || p.techs[t]) continue;
        const zuFrueh = td.zeitalter > p.zeitalter;
        const fehltVor = td.braucht && !p.techs[td.braucht];
        knopf({
          name: td.name, taste: td.name[0], kosten: kurzKosten(td.kosten), form: 'forschung',
          titel: td.name + ' — ' + kostenText(td.kosten) + '\n' + td.beschreibung
                 + (fehltVor ? '\nBraucht zuerst: ' + TECHS[td.braucht].name : ''),
          gesperrt: zuFrueh || fehltVor || !sim.kannZahlen(p.id, td.kosten) || sim.laeuftTech(p.id, t),
          tun: () => this.spiel.senden({ a: 'forschen', g: b.id, tech: t })
        });
      }
      if (b.typ === 'dorfzentrum' && p.zeitalter < ZEITALTER.length - 1) {
        const k = aufstiegKosten(p.zeitalter, p.volk);
        const z = ZEITALTER[p.zeitalter + 1];
        const genugGebaeude = sim.gebaeudeZahl(p.id, p.zeitalter) >= z.braucht;
        knopf({
          name: z.kurz + 'zeit', taste: '↑', kosten: kurzKosten(k), form: 'zeitalter',
          titel: 'Aufstieg zur ' + z.name + ' — ' + kostenText(k)
                 + '\nBraucht ' + z.braucht + ' Gebaeude des laufenden Zeitalters'
                 + '\nDauer: ' + z.dauer + ' Sekunden',
          gesperrt: !!p.aufstieg || !genugGebaeude || !sim.kannZahlen(p.id, k),
          tun: () => this.spiel.senden({ a: 'zeitalter', g: b.id })
        });
      }
      if (def.handel) {
        for (const r of ['nahrung', 'holz', 'stein']) {
          knopf({ name: 'Kaufe ' + ROHSTOFF_NAME[r], kosten: p.preise[r] + ' Gold', form: 'forschung',
            titel: '100 ' + ROHSTOFF_NAME[r] + ' fuer ' + p.preise[r] + ' Gold',
            gesperrt: p.rohstoffe.gold < p.preise[r],
            tun: () => this.spiel.senden({ a: 'handel', r, kaufen: true }) });
          knopf({ name: 'Verkauf ' + ROHSTOFF_NAME[r], kosten: '+' + Math.round(p.preise[r] * (100 - HANDEL.gebuehr) / 100) + ' Gold', form: 'forschung',
            titel: '100 ' + ROHSTOFF_NAME[r] + ' abgeben',
            gesperrt: p.rohstoffe[r] < 100,
            tun: () => this.spiel.senden({ a: 'handel', r, kaufen: false }) });
        }
      }
      /* Laufende Warteschlange */
      b.warteschlange.forEach((auftrag, i) => {
        const name = auftrag.art === 'einheit' ? sim.werte(p.id, auftrag.typ).name
                   : (auftrag.art === 'tech' ? TECHS[auftrag.typ].name : 'Zeitalter');
        knopf({
          name: name, taste: '×', form: 'einheit',
          kosten: Math.ceil(auftrag.rest / 10) + ' s',
          titel: 'Abbrechen (Kosten kommen zurueck)',
          fortschritt: 1 - auftrag.rest / auftrag.gesamt,
          tun: () => this.spiel.senden({ a: 'abbrechen', g: b.id, i })
        }).classList.add('warteschlange');
      });
      knopf({ name: 'Abreissen', taste: 'Entf', form: 'mauer',
        tun: () => this.spiel.senden({ a: 'abreissen', ids: gebaeude.map(o => o.id) }) });
      return;
    }

    /* Soldaten: Haltung und Anhalten */
    if (einheiten.length) {
      const ids = einheiten.map(o => o.id);
      /* Beladene Transporter zuerst: von Bord gehen ist der Befehl,
         den man an einem vollen Schiff am haeufigsten braucht. */
      const frachter = einheiten.filter(o => o.fracht && o.fracht.length);
      if (frachter.length) {
        const anBord = frachter.reduce((n, o) => n + o.fracht.length, 0);
        knopf({ name: 'Von Bord (' + anBord + ')', taste: 'X', form: 'einheit',
          titel: 'Setzt die Fracht am naechsten Ufer ab. Fuer eine bestimmte Stelle'
               + ' stattdessen mit der rechten Maustaste an Land klicken.',
          tun: () => this.spiel.senden({ a: 'ausladen', ids: frachter.map(o => o.id) }) });
      }
      knopf({ name: 'Anhalten', taste: 'S', form: 'einheit', tun: () => this.spiel.senden({ a: 'stopp', ids }) });
      const haltungen = [['Angriffslustig', 0], ['Verteidigend', 1], ['Stellung halten', 2], ['Zurueckhaltend', 3]];
      for (const [name, h] of haltungen) {
        knopf({ name, form: 'forschung', titel: 'Haltung: ' + name,
          tun: () => this.spiel.senden({ a: 'haltung', ids, h }) });
      }
    }
  }

  /* ─────────────── Meldungen ─────────────── */

  meldung(text, art) {
    const d = document.createElement('div');
    d.className = 'meldung' + (art ? ' ' + art : '');
    d.textContent = text;
    this.el.meldungen.appendChild(d);
    setTimeout(() => d.remove(), 7000);
    while (this.el.meldungen.children.length > 7) this.el.meldungen.firstChild.remove();
  }

  hinweis(text) {
    this.el.hinweis.textContent = text;
    this.el.hinweis.classList.add('an');
    this.hinweisUhr = performance.now() + 2200;
  }

  rahmen(r) {
    const el = this.el.rahmen;
    if (!r) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = Math.min(r.x0, r.x1) + 'px';
    el.style.top = Math.min(r.y0, r.y1) + 'px';
    el.style.width = Math.abs(r.x1 - r.x0) + 'px';
    el.style.height = Math.abs(r.y1 - r.y0) + 'px';
  }

  /* ─────────────── Minikarte ─────────────── */

  minikarteVorbereiten() {
    const k = this.sim.karte;
    this.mkPuffer = document.createElement('canvas');
    this.mkPuffer.width = k.breite; this.mkPuffer.height = k.hoehe;
    this.mkCtx = this.mkPuffer.getContext('2d');
    this.mkBild = this.mkCtx.createImageData(k.breite, k.hoehe);
    this.mk.imageSmoothingEnabled = false;
  }

  minikarteBinden() {
    const el = this.el.minikarte;
    const hin = (ev) => {
      const r = el.getBoundingClientRect();
      const k = this.sim.karte;
      const x = (ev.clientX - r.left) / r.width * k.breite;
      const z = (ev.clientY - r.top) / r.height * k.hoehe;
      if (ev.button === 2 || ev.buttons === 2) {
        /* Rechtsklick auf der Minikarte: Befehl dorthin. */
        if (this.spiel.auswahl.length && !this.spiel.zuschauer) {
          this.spiel.senden({ a: 'gehen', ids: this.spiel.auswahl.filter(id => {
            const o = this.sim.nachId.get(id);
            return o && o.art === 'einheit' && o.spieler === this.spiel.spielerId;
          }), x: Math.round(x * FP), y: Math.round(z * FP) });
        }
      } else {
        this.spiel.kamera.zentriere(x, z);
      }
    };
    el.addEventListener('mousedown', hin);
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('mousemove', (e) => { if (e.buttons === 1) hin(e); });
  }

  minikarteZeichnen() {
    const sim = this.sim, k = sim.karte;
    const bild = this.mkBild.data;
    const zuschauer = this.spiel.zuschauer;
    const pid = zuschauer ? null : this.spiel.spielerId;
    for (let y = 0; y < k.hoehe; y++) {
      for (let x = 0; x < k.breite; x++) {
        const i = y * k.breite + x;
        let [r, g, b] = BODENFARBE_MINI[k.boden[i]] || [95, 140, 60];
        const v = k.vorkommen[i];
        if (v && k.menge[i] > 0) {
          if (v === 1) { r = 44; g = 86; b = 40; }              // Wald
          else if (v === 5) { r = 214; g = 176; b = 58; }       // Gold
          else if (v === 6) { r = 168; g = 168; b = 162; }      // Stein
          else { r = 168; g = 76; b = 68; }                     // Nahrung
        }
        /* Hoehe leicht einfaerben, damit Huegel erkennbar sind. */
        const h = 0.85 + k.hoehen[i] * 0.05;
        let f = 1;
        if (pid != null) {
          const s = sim.sichtbarFuer(pid, x, y);
          f = s === 2 ? 1 : (s === 1 ? 0.55 : 0.08);
        }
        const o = i * 4;
        bild[o] = Math.min(255, r * h * f);
        bild[o + 1] = Math.min(255, g * h * f);
        bild[o + 2] = Math.min(255, b * h * f);
        bild[o + 3] = 255;
      }
    }
    this.mkCtx.putImageData(this.mkBild, 0, 0);

    const c = this.mk;
    const B = this.el.minikarte.width, H = this.el.minikarte.height;
    c.clearRect(0, 0, B, H);
    c.drawImage(this.mkPuffer, 0, 0, B, H);

    const sx = B / k.breite, sy = H / k.hoehe;
    /* Gebaeude als Quadrate, Einheiten als Punkte. */
    for (const b of sim.gebaeude) {
      if (b.tot) continue;
      if (pid != null && sim.sichtbarFuer(pid, b.kx, b.ky) === 0) continue;
      c.fillStyle = '#' + FARBEN[sim.spieler[b.spieler].farbe % FARBEN.length].hex.toString(16).padStart(6, '0');
      c.fillRect(b.kx * sx, b.ky * sy, Math.max(2, b.groesse * sx), Math.max(2, b.groesse * sy));
    }
    for (const e of sim.einheiten) {
      if (e.tot || e.verladen) continue;
      const kx = (e.x / FP) | 0, ky = (e.y / FP) | 0;
      if (pid != null && sim.sichtbarFuer(pid, kx, ky) !== 2) continue;
      c.fillStyle = '#' + FARBEN[sim.spieler[e.spieler].farbe % FARBEN.length].hex.toString(16).padStart(6, '0');
      c.fillRect(kx * sx - 1, ky * sy - 1, 3, 3);
    }
    /* Bildausschnitt der Kamera */
    const ka = this.spiel.kamera;
    if (ka) {
      c.strokeStyle = 'rgba(255,255,255,.8)';
      c.lineWidth = 1;
      const ecken = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([ex, ey]) => {
        const p = this.spiel.welt.bodenPunkt(ex * this.spiel.welt.leinwand.clientWidth, ey * this.spiel.welt.leinwand.clientHeight);
        return p ? [p.x * sx, p.z * sy] : null;
      });
      if (ecken.every(Boolean)) {
        c.beginPath();
        c.moveTo(ecken[0][0], ecken[0][1]);
        for (let i = 1; i < 4; i++) c.lineTo(ecken[i][0], ecken[i][1]);
        c.closePath();
        c.stroke();
      }
    }
  }
}

function kurzKosten(k) {
  if (!k) return '';
  const kurz = { nahrung: 'N', holz: 'H', gold: 'G', stein: 'S' };
  return ROHSTOFFE.filter(r => k[r]).map(r => k[r] + kurz[r]).join(' ');
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/\n/g, '<br>');
}
