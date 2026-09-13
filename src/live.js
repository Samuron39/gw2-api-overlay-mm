'use strict';
// Live-tilstand fra ArcDPS-broen (UDP 127.0.0.1:47500): buffs på deg, conditions på målet, cooldowns.
const dgram = require('dgram');
const fs = require('fs');
const { EventEmitter } = require('events');
const log = require('./log');

const PORT = 47500;
const NPC_ELITE = 0xffffffff;
const MAX_TARGETS = 40;
const DEDUPE_KEEP = 512; // hvor mange (scope, arcdps-id) vi husker for å avvise dobbeltleverte hendelser
const MAX_STACKS = 25;

class Live extends EventEmitter {
  constructor() {
    super();
    this.socket = null;
    this.connected = false;
    this.arcVersion = '';
    this.lastHello = 0;
    this.offset = 0; // Date.now() - arcdps-tid
    this.inCombat = false;
    this.self = null; // { id, name, prof, elite }
    this.agents = new Map(); // id -> { name, prof, elite, self }
    this.buffs = new Map(); // skill -> { name, expiries: number[], src, dur } (dur = varighet ms fra siste påføring)
    this.targetId = null;
    this.targets = new Map(); // agentId -> Map(skill -> { name, expiries })
    this.cooldowns = new Map(); // skill -> { name, castStart, castDur, fired, firedAt }
    this.weaponSet = 'A'; // A/B på land, W1/W2 i vann. Fra ArcDPS statechange 11 (dstAgent = 4/5 land, 0/1 vann)
    this.nextExpiry = null; // arcdps-tid for første utløp blant buffs i siste snapshot; da sendes ny tilstand
    this.rec = null; // { stream, file, until } mens den rå strømmen tas opp til fil (feilsøking)
    // DPS: pågående kamp og forrige kamp, regnet fra egne treff og condition-ticks i chatbox-kanalen (sanntid)
    this.fight = null; // { start, last, total, taken, targets: Map, skills: Map }
    this.lastFight = null; // ferdig oppsummert
    this.dmgWindow = []; // [arcdps-tid, skade] de siste 10 s, for "DPS nå"
    // Healing (se docs/healing-api.md): broen sender heal-linjer fra chatbox-kanalen (ch "local", sanntid, egen healing og
    // healing mottatt) og fra utvidelsen «arcdps healing stats» (ch "ext", andres healing når de deler live).
    this.healSupported = false; // hello.heal = 1: broen sender heal-linjer
    this.healExt = false; // hello.healExt = 1: healing stats-utvidelsen er lastet i spillet
    this.healSeen = false; // minst én heal-linje (eller positiv local-hendelse fra eldre bro) er telt
    this.selfInst = 0; // vår instans-id (srcInst på egne local-hendelser), for å kjenne igjen minions via srcMaster
    this.healWindow = []; // [arcdps-tid, heal] de siste 10 s, for "HPS nå"
    this.lastDpsEmit = 0;
    this.timer = null;
    this.dirty = false;
    this.lastJsonWarn = 0; // maks én JSON-advarsel per 10 s
    // Tellere for statuslinja. Tap oppdages ved hopp i broens løpenummer "n" (fallback: arcdps-id for lokale hendelser)
    this.stats = { packets: 0, events: 0, dropsDetected: 0, areaLagMs: null };
    this.lastSeq = null;
    // Sikkerhetsnett mot dobbeltlevering: samme arcdps-id i samme scope ("local"/"area") behandles bare én gang
    this.seenIds = new Set();
    this.seenOrder = [];
  }

  start(port = PORT) {
    if (this.socket) return;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (buf) => {
      this.stats.packets++;
      this.recordDatagram(buf);
      // Ett datagram kan inneholde flere linjer (broen batcher)
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        try { this.handle(JSON.parse(line)); }
        catch (e) { if (Date.now() - this.lastJsonWarn > 10000) { this.lastJsonWarn = Date.now(); log.warn('live', 'Ugyldig JSON fra broen: ' + e.message, line.slice(0, 200)); } }
      }
    });
    this.socket.on('error', (e) => log.warn('live', 'UDP-feil (port opptatt? en annen instans lytter)', e.message));
    this.socket.bind(port, '127.0.0.1');
    this.timer = setInterval(() => {
      if (this.connected && Date.now() - this.lastHello > 6000) { this.connected = false; this.dirty = true; log.info('live', 'Broen koblet fra (ingen hello på 6 s)'); }
      // En buff som løper ut er også en endring: uten dette fikk vinduene ingen ny tilstand før neste kamphendelse,
      // og telte videre i minus på egen hånd
      if (this.nextExpiry != null && this.now() >= this.nextExpiry) this.dirty = true;
      if (this.rec && Date.now() > this.rec.until) this.stopRecording();
      // Pågående kamp: ny tilstand to ganger i sekundet så DPS-vinduet teller, og avslutt om kampslutt-hendelsen uteble
      if (this.fight) {
        if (!this.inCombat && this.now() - this.fight.last > 8000) this.endFight(this.now());
        else if (Date.now() - this.lastDpsEmit > 500) { this.lastDpsEmit = Date.now(); this.dirty = true; }
      }
      if (this.dirty) { this.dirty = false; this.emit('update', this.snapshot()); }
    }, 100);
  }

  stop() { clearInterval(this.timer); this.timer = null; this.socket?.close(); this.socket = null; this.stopRecording(); }

  // Feilsøking: skriv hvert datagram til fil med ankomsttid (ms siden epoch) foran hver linje, i inntil ms millisekunder.
  // Lar oss se nøyaktig hva broen sender rundt en hendelse uten å stoppe overlayen.
  record(file, ms) {
    this.stopRecording();
    fs.mkdirSync(require('path').dirname(file), { recursive: true });
    const stream = fs.createWriteStream(file, { flags: 'a' });
    stream.write('# GW2 Overlay live-opptak ' + new Date().toISOString() + ' (ankomst-ms<TAB>linje)\n');
    this.rec = { stream, file, until: Date.now() + ms };
    this.dirty = true;
    log.info('live', 'Tar opp strømmen', { file, ms });
    return { file, until: this.rec.until };
  }
  recordDatagram(buf) {
    const r = this.rec;
    if (!r) return;
    if (Date.now() > r.until) { this.stopRecording(); return; }
    const at = Date.now();
    for (const line of buf.toString('utf8').split('\n')) if (line.trim()) r.stream.write(at + '\t' + line + '\n');
  }
  stopRecording() {
    if (!this.rec) return;
    try { this.rec.stream.end(); } catch { /* allerede lukket */ }
    log.info('live', 'Opptak ferdig', this.rec.file);
    this.rec = null;
    this.dirty = true;
  }

  now() { return Date.now() - this.offset; } // i arcdps-tid

  // Tapsdeteksjon: hopp i broens løpenummer "n" betyr tapte datagram. Eldre bro uten "n": bruk arcdps-id for lokale hendelser.
  trackSeq(m) {
    const seq = typeof m.n === 'number' ? m.n : (m.s === 'local' && typeof m.id === 'number' ? m.id : null);
    if (seq == null) return;
    if (this.lastSeq != null && seq > this.lastSeq + 1) this.stats.dropsDetected += seq - this.lastSeq - 1;
    if (this.lastSeq == null || seq > this.lastSeq || seq < this.lastSeq - 1000) this.lastSeq = seq; // stort fall bakover = broen startet på nytt
  }

  handle(m) {
    if (m.t === 'hello') {
      if (!this.connected) { this.connected = true; this.dirty = true; log.info('live', 'Broen koblet til', { arc: m.arc || '' }); }
      this.arcVersion = m.arc || ''; this.lastHello = Date.now();
      const heal = m.heal === 1, ext = m.healExt === 1;
      if (heal !== this.healSupported || ext !== this.healExt) { this.healSupported = heal; this.healExt = ext; this.dirty = true; if (heal) log.info('live', 'Broen støtter healing', { healingStats: ext }); }
      return;
    }
    if (m.t === 'heal') {
      this.stats.events++;
      this.trackSeq(m);
      // dedupe per kanal: samme arcdps-id kan komme både på local og (fra utvidelsen) på ext
      if (this.isDuplicate({ s: 'heal-' + m.ch, id: m.id })) return;
      if (m.ch !== 'ext' || this.offset == null) this.offset = Date.now() - m.time; // local er sanntid, ext er forsinket
      this.addHeal(m);
      return;
    }
    if (m.t !== 'agent' && m.t !== 'ev') return;
    this.stats.events++;
    this.trackSeq(m);
    if (m.t === 'agent') {
      // Målbytte: ev == null og src.elite == 1 (README.txt), src.id = det nye målet, dst = null. Eldre bro sendte 0xffffffff.
      if (m.src && (m.src.elite === 1 || m.src.elite === NPC_ELITE) && m.src.id > 0 && (m.dst == null || m.dst.self === 1)) {
        if (!this.agents.has(m.src.id)) this.agents.set(m.src.id, { id: m.src.id, name: m.src.name || '', prof: m.src.prof, elite: m.src.elite, self: 0 });
        if (this.targetId !== m.src.id) { this.targetId = m.src.id; this.dirty = true; }
        return;
      }
      // Agent fjernet (ev == null, src.prof == 0): ingenting å gjøre, målet beholdes til et nytt velges
      if (m.src && !m.src.prof && m.dst == null) return;
      // Agent-registrering: src har id og navn, dst har prof, elite, self og kontonavn
      if (m.src && m.dst && m.dst.self === 1 && m.src.name) {
        this.self = { id: m.src.id, name: m.src.name, prof: m.dst.prof, elite: m.dst.elite, account: m.dst.name };
        this.agents.set(m.src.id, { ...this.self, self: 1 });
        this.dirty = true;
      } else if (m.src && m.src.name && m.dst) {
        this.agents.set(m.src.id, { id: m.src.id, name: m.src.name, prof: m.dst.prof, elite: m.dst.elite, self: m.dst.self });
      }
      return;
    }
    if (m.t !== 'ev' || this.isDuplicate(m)) return;
    // Klokkeavvik mot arcdps-tid settes bare fra chatbox-kanalen (sanntid). Evtc-kanalen (area) kommer 2–3 s forsinket,
    // og ville skjøvet alle nedtellinger tilsvarende. Nedtellingene regnes fra hendelsens egen tid, så en forsinket
    // påføring starter riktig sted i tida.
    if (m.s !== 'area' || this.offset == null) this.offset = Date.now() - m.time;
    // Målt forsinkelse på evtc-kanalen: hvor lenge etter hendelsens egen tid den kom fram (glidende snitt)
    if (m.s === 'area') {
      const lag = Date.now() - (m.time + this.offset);
      if (lag >= 0 && lag < 30000) this.stats.areaLagMs = this.stats.areaLagMs == null ? lag : Math.round(this.stats.areaLagMs * 0.8 + lag * 0.2);
    }
    const srcSelf = m.src?.self === 1;
    if (m.src?.name) this.agents.set(m.src.id, { id: m.src.id, name: m.src.name, prof: m.src.prof, elite: m.src.elite, self: m.src.self });
    if (m.dst?.name) this.agents.set(m.dst.id, { id: m.dst.id, name: m.dst.name, prof: m.dst.prof, elite: m.dst.elite, self: m.dst.self });
    if (srcSelf && !this.self) this.self = { id: m.src.id, name: m.src.name, prof: m.src.prof, elite: m.src.elite };
    if (srcSelf && m.s !== 'area' && m.srcInst > 0) this.selfInst = m.srcInst;

    if (m.sc === 1 && srcSelf) { this.inCombat = true; if (m.s !== 'area') this.startFight(m.time); this.dirty = true; return; }
    // Ut av kamp: målet nullstilles. ArcDPS sender ikke CHANGEDEAD for vanlige fiender i åpen verden, så død
    // oppdages via dødsstøtet vårt (result 8, CBTR_KILLINGBLOW, chatbox-kanalen i sanntid) og ellers ved kampslutt.
    if (m.sc === 2 && srcSelf) { this.inCombat = false; if (m.s !== 'area') this.endFight(m.time); this.clearTarget(); this.dirty = true; return; }
    if (m.sc === 11 && srcSelf) { const v = Number(m.dstAgent); this.weaponSet = v === 5 ? 'B' : v === 4 ? 'A' : v === 1 ? 'W2' : v === 0 ? 'W1' : this.weaponSet; this.dirty = true; return; }
    // sc 18 (CBTS_BUFFINITIAL): buffs som allerede ligger på agenten ved oppstart eller kartbytte. Samme felt som en påføring.
    if (m.sc === 18) { this.applyBuff(m, false); return; }
    // Nyere ArcDPS (2026) merker vanlige hendelser i evtc-kanalen med egne statechange-koder i stedet for 0 (målt 13. sept 2026;
    // ordinalene i cbtstatechange slik broen faktisk får dem): 67 ANIMATIONSTART, 68 ANIMATIONSTOP, 69 BUFFAPPLY, 70 BUFFCHANGE,
    // 71 BUFFREMOVE_SINGLE, 72 BUFFREMOVE_ALL. Oversettes til de gamle feltene (act/rem/buff) så resten av logikken er felles.
    if (m.sc === 67) { m.sc = 0; m.act = 1; m.buff = 0; m.rem = 0; } // value = ms til treffpunktet (castDur)
    else if (m.sc === 68) { m.sc = 0; m.act = m.act === 4 ? 4 : 3; m.buff = 0; m.rem = 0; } // cbtanimation: 3/5/6 = utført, 4 = avbrutt
    else if (m.sc === 69) { m.sc = 0; m.buff = 1; m.rem = 0; m.act = 0; m.buffDmg = 0; } // value = varighet ms, dst = mottaker
    else if (m.sc === 70) { this.changeBuff(m); return; } // overstack = ny varighet for den aktive stacken
    else if (m.sc === 71) { m.sc = 0; m.buff = 1; m.act = 0; if (!m.rem) m.rem = 2; } // én stack, src = den som hadde buffen
    else if (m.sc === 72) { m.sc = 0; m.buff = 1; m.act = 0; m.rem = 1; } // alle stacks
    if (m.sc !== 0) return;

    // Aktivering av skill (bare egne)
    if (m.act !== 0) {
      if (!srcSelf) return;
      if (m.act === 1 || m.act === 2) this.cooldowns.set(m.skill, { name: m.name, castStart: m.time, castDur: m.value, fired: false, firedAt: 0 });
      else if (m.act === 3 || m.act === 5) { const c = this.cooldowns.get(m.skill); if (c) { c.fired = true; c.firedAt = m.time; } else this.cooldowns.set(m.skill, { name: m.name, castStart: m.time, castDur: 0, fired: true, firedAt: m.time }); }
      else if (m.act === 4) this.cooldowns.delete(m.skill);
      this.dirty = true;
      return;
    }

    // Buff fjernet: src = den som hadde buffen
    if (m.rem !== 0) {
      const owner = m.src;
      if (!owner) return;
      const map = owner.self === 1 ? this.buffs : this.targets.get(owner.id);
      if (!map) return;
      const b = map.get(m.skill);
      // rem === 1: alle stacks fjernet. Nullstiller uansett hva vi tror vi har, så en tapt påføring ikke henger igjen.
      if (m.rem === 1) { if (b) { map.delete(m.skill); this.dirty = true; } return; }
      if (!b) return;
      // fjern den stacken som utløper først
      let i = 0;
      for (let k = 1; k < b.expiries.length; k++) if (b.expiries[k] < b.expiries[i]) i = k;
      b.expiries.splice(i, 1);
      if (!b.expiries.length) map.delete(m.skill);
      this.dirty = true;
      return;
    }

    // Buff påført: dst får buffen, value = varighet ms
    if (m.buff === 1 && m.value > 0) { this.applyBuff(m, true); return; }

    // Healing fra en eldre bro (uten heal-linjer): i chatbox-kanalen er skade negativ og healing POSITIV (samme regel som
    // «arcdps healing stats», src/Common.h GetEventType). Uten dette ville en heal fra en annen spiller telt som mottatt skade.
    // iff 1 (fiende) holdes utenfor så positive testverdier mot fiender fortsatt er skade.
    if (m.s === 'local' && m.iff !== 1 && Live.legacyHealAmount(m) > 0) { this.addHeal({ ...m, ch: 'local', value: Live.legacyHealAmount(m), barrier: 0, over: 0 }); return; }
    // Skade mot oss (chatbox-kanalen): telles som mottatt i kampregnskapet
    if (!srcSelf && m.dst?.self === 1 && (m.value !== 0 || m.buffDmg !== 0)) { this.addTaken(m); return; }
    // Skade fra oss mot fiende: husk målet. Chatbox-kanalen gir skade som negativt tall, derfor != 0.
    if (srcSelf && m.iff === 1 && m.dst && (m.value !== 0 || m.buffDmg !== 0)) {
      this.addDamage(m);
      if (m.result === 8) { // CBTR_KILLINGBLOW: målet døde av dette treffet
        this.targets.delete(m.dst.id);
        if (this.targetId === m.dst.id) this.clearTarget();
        this.dirty = true;
        return;
      }
      if (this.targetId !== m.dst.id) { this.targetId = m.dst.id; this.dirty = true; }
    }
  }

  clearTarget() { if (this.targetId != null) { this.targetId = null; this.dirty = true; } }

  // ---------- DPS ----------
  // Skademengden i en hendelse: strike = value (negativt i chatbox-kanalen), condition-tick = buffDmg.
  // Blokkert, unnveket, absorbert, bommet (blind), breakbar-skade og skill-signal teller ikke.
  static damageOf(m) {
    if ([3, 4, 6, 7, 10, 11].includes(m.result)) return 0;
    if (m.buff === 1) return Math.abs(Number(m.buffDmg) || 0);
    return Math.abs(Number(m.value) || 0);
  }
  startFight(t) {
    if (this.fight) return; // allerede i gang (kamp inn kommer også forsinket på evtc-kanalen)
    this.fight = {
      start: t, last: t, total: 0, taken: 0, targets: new Map(), skills: new Map(),
      // healing: heal = egen healing gjort (inkl. barrier), barrier = barrier-delen av den, healSkills per skill,
      // healReceived = healing mottatt (også egen), healSources per kilde, squadHeal = andres healing (ext-kanalen)
      heal: 0, barrier: 0, healSkills: new Map(), healReceived: 0, healSources: new Map(), squadHeal: new Map(),
    };
    this.dmgWindow = [];
    this.healWindow = [];
    this.dirty = true;
  }

  // ---------- Healing ----------
  // Eldre bro sender healing som vanlige ev-linjer med positiv verdi i chatbox-kanalen: direkte healing i value (buff 0,
  // result vanlig/crit/glance), regenerasjon i buffDmg (buff 1). 0 = ikke healing.
  static legacyHealAmount(m) {
    if (m.sc !== 0 || m.act !== 0 || m.rem !== 0) return 0;
    if (m.buff === 1) return Number(m.buffDmg) > 0 ? Number(m.buffDmg) : 0;
    return [0, 1, 2].includes(m.result) && Number(m.value) > 0 ? Number(m.value) : 0;
  }
  // En heal-linje (eller normalisert eldre hendelse). Telles bare i en pågående kamp: healing utenfor kamp (regenerasjon
  // mens man står stille) skal ikke starte en kamp, det gjør bare kamp-inn og egne treff.
  addHeal(h) {
    const amt = Number(h.value) || 0;
    if (amt <= 0 || !this.fight) return;
    const f = this.fight;
    const srcSelf = h.src?.self === 1 || (this.selfInst > 0 && h.srcMaster === this.selfInst);
    const dstSelf = h.dst?.self === 1;
    if (h.src?.name) this.agents.set(h.src.id, { id: h.src.id, name: h.src.name, prof: h.src.prof, elite: h.src.elite, self: h.src.self });
    if (h.dst?.name) this.agents.set(h.dst.id, { id: h.dst.id, name: h.dst.name, prof: h.dst.prof, elite: h.dst.elite, self: h.dst.self });
    if (h.ch === 'ext') {
      // Fra healing stats-utvidelsen (2–3 s forsinket): egne hendelser er duplikater av local-kanalen og hoppes over.
      // Andres healing (squad-medlemmer som deler live) er eneste vei til en squad-liste.
      if (srcSelf || !h.src) return;
      const sq = f.squadHeal.get(h.src.id) || { id: h.src.id, name: h.src.name || '', heal: 0 };
      sq.heal += amt; if (h.src.name) sq.name = h.src.name; f.squadHeal.set(h.src.id, sq);
      this.healSeen = true; this.dirty = true;
      return;
    }
    if (!srcSelf && !dstSelf) return;
    if (srcSelf) {
      f.heal += amt;
      if (h.barrier) f.barrier += amt;
      const key = Number(h.skill) || 0;
      const sk = f.healSkills.get(key) || { skill: key, name: h.name || '', heal: 0, hits: 0 };
      sk.heal += amt; sk.hits++; if (h.name) sk.name = h.name; f.healSkills.set(key, sk);
      this.healWindow.push([h.time, amt]);
    }
    if (dstSelf) {
      f.healReceived += amt;
      const sid = h.src?.id ?? 0;
      const so = f.healSources.get(sid) || { id: sid, name: h.src?.name || '', heal: 0 };
      so.heal += amt; if (h.src?.name) so.name = h.src.name; f.healSources.set(sid, so);
    }
    this.healSeen = true;
    this.dirty = true;
  }
  healingSummary(f, durationMs) {
    const bySkill = [...f.healSkills.values()].sort((a, b) => b.heal - a.heal).slice(0, 5).map((s) => ({ ...s, pct: f.heal ? Math.round(s.heal / f.heal * 100) : 0 }));
    const bySource = [...f.healSources.values()].sort((a, b) => b.heal - a.heal).slice(0, 3).map((s) => ({ ...s, pct: f.healReceived ? Math.round(s.heal / f.healReceived * 100) : 0 }));
    const squad = [...f.squadHeal.values()].sort((a, b) => b.heal - a.heal).slice(0, 5);
    return { done: f.heal, barrier: f.barrier, hps: Math.round(f.heal / durationMs * 1000), hps10: 0, bySkill, received: f.healReceived, bySource, squad, available: this.healSupported || this.healSeen };
  }
  endFight(t) {
    const f = this.fight;
    if (!f) return;
    this.fight = null;
    if (f.total > 0 || f.taken > 0 || f.heal > 0 || f.healReceived > 0) this.lastFight = this.summarize(f, Math.max(t, f.last));
    this.dirty = true;
  }
  addDamage(m) {
    const amt = Live.damageOf(m);
    if (!amt) return;
    if (!this.fight) this.startFight(m.time);
    const f = this.fight;
    f.total += amt; f.last = Math.max(f.last, m.time);
    const tg = f.targets.get(m.dst.id) || { id: m.dst.id, name: m.dst.name || '', dmg: 0 };
    tg.dmg += amt; if (m.dst.name) tg.name = m.dst.name; f.targets.set(m.dst.id, tg);
    const sk = f.skills.get(m.skill) || { skill: m.skill, name: m.name || '', dmg: 0, hits: 0 };
    sk.dmg += amt; sk.hits++; if (m.name) sk.name = m.name; f.skills.set(m.skill, sk);
    this.dmgWindow.push([m.time, amt]);
    this.dirty = true;
  }
  addTaken(m) {
    const amt = Live.damageOf(m);
    if (!amt || !this.fight) return;
    this.fight.taken += amt; this.fight.last = Math.max(this.fight.last, m.time);
    this.dirty = true;
  }
  summarize(f, end) {
    const durationMs = Math.max(1000, end - f.start);
    const targets = [...f.targets.values()].sort((a, b) => b.dmg - a.dmg).slice(0, 3);
    const skills = [...f.skills.values()].sort((a, b) => b.dmg - a.dmg).slice(0, 8).map((s) => ({ ...s, pct: f.total ? Math.round(s.dmg / f.total * 100) : 0 }));
    return { durationMs, total: f.total, taken: f.taken, dps: Math.round(f.total / durationMs * 1000), targets, skills, target: targets[0]?.name || '', healing: this.healingSummary(f, durationMs) };
  }
  dpsSnapshot(now) {
    const f = this.fight;
    let cur = null;
    if (f) {
      cur = this.summarize(f, now);
      const from = now - 10000;
      while (this.dmgWindow.length && this.dmgWindow[0][0] < from) this.dmgWindow.shift();
      let sum = 0; for (const [, a] of this.dmgWindow) sum += a;
      const span = Math.min(10000, Math.max(1000, now - f.start));
      cur.dps10 = Math.round(sum / span * 1000);
      // HPS nå: egen healing de siste 10 s
      while (this.healWindow.length && this.healWindow[0][0] < from) this.healWindow.shift();
      let hsum = 0; for (const [, a] of this.healWindow) hsum += a;
      cur.healing.hps10 = Math.round(hsum / span * 1000);
      cur.active = true;
    }
    // healing.supported = broen har meldt heal-støtte i hello, ext = healing stats-utvidelsen er lastet i spillet
    return { current: cur, last: this.lastFight, healing: { available: this.healSupported || this.healSeen, supported: this.healSupported, ext: this.healExt } };
  }

  // Samme arcdps-id i samme scope to ganger = samme hendelse levert to ganger. Husker de siste DEDUPE_KEEP.
  isDuplicate(m) {
    if (typeof m.id !== 'number' || m.id <= 0) return false;
    const key = `${m.s}|${m.id}`;
    if (this.seenIds.has(key)) return true;
    this.seenIds.add(key);
    this.seenOrder.push(key);
    if (this.seenOrder.length > DEDUPE_KEEP) this.seenIds.delete(this.seenOrder.shift());
    return false;
  }

  // Legger en stack på dst. value = varighet ms. setTarget: om et treff fra oss på en fiende skal flytte målet (ikke ved sc 18).
  applyBuff(m, setTarget) {
    const dst = m.dst;
    if (!dst || !(m.value > 0)) return;
    let map;
    if (dst.self === 1) map = this.buffs;
    else {
      map = this.targets.get(dst.id);
      if (!map) { this.pruneTargets(); map = new Map(); this.targets.set(dst.id, map); }
      if (setTarget && m.src?.self === 1 && m.iff === 1) this.targetId = dst.id; // det vi sist traff med noe
    }
    let b = map.get(m.skill);
    if (!b) { b = { name: m.name, expiries: [], src: m.src?.name || '', dur: 0 }; map.set(m.skill, b); }
    b.dur = m.value;
    b.expiries.push(m.time + m.value);
    if (b.expiries.length > MAX_STACKS) b.expiries.shift();
    this.dirty = true;
  }

  // BUFFCHANGE (sc 70): den aktive stacken på dst fikk ny varighet (overstack = ny ms). Finnes ingen stack, legges én til.
  changeBuff(m) {
    const dst = m.dst;
    const dur = Number(m.overstack) || 0;
    if (!dst || dur <= 0) return;
    const map = dst.self === 1 ? this.buffs : this.targets.get(dst.id);
    const b = map && map.get(m.skill);
    if (!b) { this.applyBuff({ ...m, value: dur }, false); return; }
    let i = 0;
    for (let k = 1; k < b.expiries.length; k++) if (b.expiries[k] > b.expiries[i]) i = k;
    b.expiries[i] = m.time + dur;
    if (dur > b.dur) b.dur = dur;
    this.dirty = true;
  }

  // Rydd gamle mål når det blir mange. Kalles bare når et nytt mål legges til, ikke per snapshot. Gjeldende mål beholdes.
  pruneTargets() {
    if (this.targets.size < MAX_TARGETS) return;
    let n = this.targets.size - MAX_TARGETS / 2;
    for (const k of this.targets.keys()) {
      if (n <= 0) break;
      if (k === this.targetId) continue;
      this.targets.delete(k); n--;
    }
  }

  // Liste i innsettingsrekkefølge (overlay-vinduet sorterer selv etter brukerens valg). Kalles opptil 10 ganger i sekundet:
  // én gjennomgang per buff, ny expiries-liste bare når noe faktisk har utløpt. Utløp styres bare av expiries: permanente
  // buffs (attunement, kit, legend-stance) har lang varighet og skal ikke ryddes fordi det er stille rundt dem.
  // max = varigheten fra siste påføring, så kakediagrammet i overlayen får riktig total.
  buffList(map) {
    const now = this.now();
    const out = [];
    for (const [skill, b] of map) {
      let alive = 0, last = 0;
      for (const e of b.expiries) if (e > now) { alive++; if (e > last) last = e; }
      if (!alive) { map.delete(skill); continue; }
      if (alive !== b.expiries.length) b.expiries = b.expiries.filter((e) => e > now);
      out.push({ skill, name: b.name, stacks: alive, remainingMs: last - now, max: b.dur || 0, src: b.src });
    }
    return out;
  }

  snapshot() {
    const now = this.now();
    const target = this.targetId != null ? this.agents.get(this.targetId) : null;
    const tmap = this.targetId != null ? this.targets.get(this.targetId) : null;
    const cooldowns = [];
    for (const [skill, c] of this.cooldowns) {
      if (now - c.castStart > 10 * 60e3) { this.cooldowns.delete(skill); continue; }
      cooldowns.push({ skill, name: c.name, castStart: c.castStart, castDur: c.castDur, fired: c.fired, sinceMs: now - (c.fired ? c.firedAt : c.castStart + c.castDur) });
    }
    const buffs = this.buffList(this.buffs);
    const tbuffs = tmap ? this.buffList(tmap) : [];
    let next = null;
    for (const b of buffs) if (next == null || b.remainingMs < next) next = b.remainingMs;
    for (const b of tbuffs) if (next == null || b.remainingMs < next) next = b.remainingMs;
    this.nextExpiry = next == null ? null : now + next;
    return {
      connected: this.connected, arcVersion: this.arcVersion, inCombat: this.inCombat, weaponSet: this.weaponSet,
      self: this.self, buffs,
      target: target ? { id: target.id, name: target.name, buffs: tbuffs } : null,
      cooldowns, arcNow: now,
      stats: { ...this.stats },
      recording: this.rec ? { file: this.rec.file, until: this.rec.until } : null,
      dps: this.dpsSnapshot(now),
    };
  }
}

module.exports = new Live();
