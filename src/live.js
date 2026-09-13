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
const LAST_HITS = 10; // ringbuffer med siste treff mot deg
const DEATH_DEDUPE_MS = 2000; // samme ned/død-signal fra begge kanaler og begge veier (statechange og result) innen dette regnes som ett

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
    this.fight = null; // { start, last, total, taken, targets: Map, skills: Map, takenSrc: Map, takenSkills: Map }
    this.lastFight = null; // ferdig oppsummert
    this.dmgWindow = []; // [arcdps-tid, skade] de siste 10 s, for "DPS nå"
    // Squad-DPS: andres skade kommer på evtc-kanalen (area, 2–3 s forsinket). Minioner tilskrives eieren via
    // src_master_instid, så vi trenger instans-id -> agent-id. README: «src_instid - id of agent as appears in game at time
    // of event», «src_master_instid - if src_agent has a master (eg. is minion), will be equal to instid of master».
    this.inst = new Map(); // instans-id (u16) -> agent-id
    this.accounts = new Map(); // agent-id -> kontonavn (fra agent-registrering, dst.name)
    this.selfInst = 0; // egen instans-id, for å hoppe over egne minioner i squad-regnskapet
    this.lastRaw = null; // rå kampregnskap for forrige kamp, så forsinket squad-skade kan legges til etter kampslutt
    // ---------- Mottatt skade og dødslogg ----------
    // Ringbuffer med de siste LAST_HITS treffene mot deg (nyeste sist), uavhengig av kamp; tømmes ved kampstart.
    this.lastHits = []; // { time, skill, name, source, amount, kind: 'strike'|'cond' }
    // Frosset kopi av ringbufferen da du gikk ned eller døde; beholdes til neste kampstart
    this.death = null; // { time, at, downed, hits, killer, skill, amount }
    this.deathSeen = []; // [{ downed, time }] signaler vi alt har registrert (dedupe mellom kanaler og veier)
    // Healing (se docs/healing-api.md): broen sender heal-linjer fra chatbox-kanalen (ch "local", sanntid, egen healing og
    // healing mottatt) og fra utvidelsen «arcdps healing stats» (ch "ext", andres healing når de deler live).
    this.healSupported = false; // hello.heal = 1: broen sender heal-linjer
    this.healExt = false; // hello.healExt = 1: healing stats-utvidelsen er lastet i spillet
    this.healSeen = false; // minst én heal-linje (eller positiv local-hendelse fra eldre bro) er telt
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
      // Squad-DPS: README (API): «dst->id = instance id on map», «dst->name = acc names»
      if (m.src && m.dst && m.src.name) {
        if (m.dst.id > 0) { this.inst.set(m.dst.id, m.src.id); if (m.dst.self === 1) this.selfInst = m.dst.id; }
        if (m.dst.name) this.accounts.set(m.src.id, m.dst.name);
      }
      if (m.src && m.dst && m.dst.self === 1 && m.src.name) {
        this.self = { id: m.src.id, name: m.src.name, prof: m.dst.prof, elite: m.dst.elite, account: m.dst.name };
        this.agents.set(m.src.id, { ...this.self, self: 1 });
        this.dirty = true;
      } else if (m.src && m.src.name && m.dst) {
        this.agents.set(m.src.id, { id: m.src.id, name: m.src.name, prof: m.dst.prof, elite: m.dst.elite, self: m.dst.self });
      }
      // API-README: ved agent-registrering er "dst->id = instance id on map". Husk instid -> agent for minion-eiere.
      if (m.src && m.dst && m.src.name && m.dst.id > 0) this.inst.set(m.dst.id, m.src.id);
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
    // Squad-DPS: instans-id -> agent-id fra hver hendelse (README: «src_instid - id of agent as appears in game at time of event»)
    if (m.src && m.srcInst > 0 && m.src.id > 0) { this.inst.set(m.srcInst, m.src.id); if (srcSelf) this.selfInst = m.srcInst; }
    if (m.dst && m.dstInst > 0 && m.dst.id > 0) this.inst.set(m.dstInst, m.dst.id);
    // ---------- Dødslogg: nedkjempet/død for deg selv via statechange ----------
    // evtc-README, enum cbtstatechange i rekkefølge: CBTS_COMBAT = 0, ENTERCOMBAT (1), EXITCOMBAT (2), CHANGEUP (3),
    // CHANGEDEAD (4) "agent is dead at time of event", CHANGEDOWN (5) "agent is down at time of event"; "src_agent: relates
    // to agent", "realtime: limited to squad" (du er alltid i din egen squad, så de kommer på chatbox-kanalen også).
    // Vi legger ordinalen til grunn (4 og 5): de lave kodene 1, 2, 9, 10, 11 og 18 er målt å stemme med ordinalen, det er
    // bare de nyeste (67–72) som ligger én under README. Ikke verifisert i spillet ennå, se sluttrapporten.
    if ((m.sc === 4 || m.sc === 5) && srcSelf) { this.recordDeath(m.sc === 5, m.time, null); return; }

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

    // Squad-DPS: skade på evtc-kanalen (area) er andres treff og condition-ticks mot fiender (broen slipper dem gjennom).
    // Egen skade og skade mot oss telles fra chatbox-kanalen i sanntid og skal aldri telles igjen herfra.
    if (m.s === 'area') { this.addSquadDamage(m); return; }
    // Healing fra en eldre bro (uten heal-linjer): i chatbox-kanalen er skade negativ og healing POSITIV (samme regel som
    // «arcdps healing stats», src/Common.h GetEventType). Uten dette ville en heal fra en annen spiller telt som mottatt skade.
    // iff 1 (fiende) holdes utenfor så positive testverdier mot fiender fortsatt er skade.
    if (m.s === 'local' && m.iff !== 1 && Live.legacyHealAmount(m) > 0) { this.addHeal({ ...m, ch: 'local', value: Live.legacyHealAmount(m), barrier: 0, over: 0 }); return; }
    // Skade mot oss (chatbox-kanalen): telles som mottatt i kampregnskapet. Dødsstøt (result 8) og nedkjempet (result 9)
    // mot oss kommer som egen hendelse med value 0 (målt for våre egne dødsstøt i opptaket), derfor slippes de også gjennom.
    if (!srcSelf && m.dst?.self === 1 && (m.value !== 0 || m.buffDmg !== 0 || m.result === 8 || m.result === 9)) { this.addTaken(m); return; }
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
      start: t, last: t, total: 0, taken: 0, targets: new Map(), skills: new Map(), squad: new Map(), takenSrc: new Map(), takenSkills: new Map(),
      // healing: heal = egen healing gjort (inkl. barrier), barrier = barrier-delen av den, healSkills per skill,
      // healReceived = healing mottatt (også egen), healSources per kilde, squadHeal = andres healing (ext-kanalen)
      heal: 0, barrier: 0, healSkills: new Map(), healReceived: 0, healSources: new Map(), squadHeal: new Map(),
    };
    this.dmgWindow = [];
    this.healWindow = [];
    // Ny kamp: siste treff og dødsloggen fra forrige kamp slippes
    this.lastHits = [];
    this.death = null;
    this.deathSeen = [];
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
    f.end = Math.max(t, f.last);
    this.lastRaw = f; // squad-skade som kommer forsinket etter kampslutt legges til her (se addSquadDamage)
    if (f.total > 0 || f.taken > 0 || f.squad.size || f.heal > 0 || f.healReceived > 0) this.lastFight = this.summarize(f, f.end);
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
  // ---------- Mottatt skade ----------
  // Kilden til et treff mot deg, med minions tilskrevet eieren. evtc-README: "src_master_instid - if src_agent has a master
  // (eg. is minion), will be equal to instid of master, zero otherwise". Eieren slås opp via instid -> agent-id (inst);
  // er eieren ukjent ennå, brukes minionens eget navn under eierens nøkkel, og navnet rettes når eieren dukker opp.
  sourceOf(m) {
    const src = m.src || {};
    const master = Number(m.srcMaster) || 0;
    if (master > 0) {
      const ownerId = this.inst.get(master);
      const owner = ownerId != null ? this.agents.get(ownerId) : null;
      if (owner && owner.name) return { key: 'a' + ownerId, id: ownerId, name: owner.name, prof: owner.prof, elite: owner.elite, resolved: true, master };
      return { key: 'm' + master, id: ownerId ?? null, name: src.name || '', prof: src.prof, elite: src.elite, resolved: false, master };
    }
    return { key: 'a' + (src.id ?? 0), id: src.id ?? 0, name: src.name || '', prof: src.prof, elite: src.elite, resolved: true };
  }
  addTaken(m) {
    const amt = Live.damageOf(m);
    const s = this.sourceOf(m);
    // Nedkjempet (result 9, CBTR_DOWNED "target was downed by skill") og dødsstøt (result 8, CBTR_KILLINGBLOW "target was
    // killed by skill") mot deg: den andre veien til dødsloggen, i tillegg til CHANGEDOWN/CHANGEDEAD. Kilden er drapsmannen.
    const fatal = m.result === 8 || m.result === 9;
    if (!amt && !fatal) return;
    if (amt) {
      if (!this.fight) this.startFight(m.time); // å bli truffet er også kamp (første treff kommer før sc 1 i opptaket)
      const f = this.fight;
      f.taken += amt; f.last = Math.max(f.last, m.time);
      const ts = f.takenSrc.get(s.key) || { id: s.id, name: s.name, prof: s.prof, elite: s.elite, dmg: 0, hits: 0 };
      // Eieren ble kjent etter at minionen alt hadde truffet: flytt det som lå under den midlertidige nøkkelen over på eieren
      if (s.resolved && s.master) { const tmp = f.takenSrc.get('m' + s.master); if (tmp) { ts.dmg += tmp.dmg; ts.hits += tmp.hits; f.takenSrc.delete('m' + s.master); } }
      ts.dmg += amt; ts.hits++;
      if (s.name && (!ts.name || s.resolved)) { ts.name = s.name; ts.prof = s.prof; ts.elite = s.elite; if (s.id != null) ts.id = s.id; }
      f.takenSrc.set(s.key, ts);
      const sk = f.takenSkills.get(m.skill) || { skill: m.skill, name: m.name || '', dmg: 0, hits: 0 };
      sk.dmg += amt; sk.hits++; if (m.name) sk.name = m.name; f.takenSkills.set(m.skill, sk);
      this.lastHits.push({ time: m.time, skill: m.skill, name: m.name || '', source: s.name, amount: amt, kind: m.buff === 1 ? 'cond' : 'strike' });
      if (this.lastHits.length > LAST_HITS) this.lastHits.shift();
    }
    if (fatal) this.recordDeath(m.result === 9, m.time, { killer: s.name, skill: m.name || '', amount: amt });
    this.dirty = true;
  }
  // Fryser ringbufferen som dødslogg. downed: nedkjempet (kan reddes), ellers død. hit: treffet som felte deg når vi vet det
  // (result-veien), ellers brukes siste treff i bufferen. Samme signal fra begge kanaler (area kommer 2–3 s etter local, med
  // samme hendelsestid) og begge veier (statechange og result, noen ms fra hverandre) dedupliseres på (downed, tid).
  recordDeath(downed, time, hit) {
    const dup = this.deathSeen.find((d) => d.downed === downed && Math.abs(d.time - time) < DEATH_DEDUPE_MS);
    if (dup) {
      // Statechange-veien kom først og kjenner ikke drapsmannen: fyll inn fra result-veien
      if (hit && this.death && this.death.downed === downed && !this.death.killer) Object.assign(this.death, hit);
      return;
    }
    this.deathSeen.push({ downed, time });
    if (this.deathSeen.length > 20) this.deathSeen.shift();
    const last = this.lastHits[this.lastHits.length - 1];
    this.death = {
      time, at: time + this.offset, downed, hits: this.lastHits.slice(),
      killer: hit?.killer || last?.source || '',
      skill: hit?.skill || last?.name || '',
      amount: hit?.amount || last?.amount || 0,
    };
    this.dirty = true;
  }
  // ---------- Squad-DPS ----------
  // Andres skade fra evtc-kanalen. Eieren er src, eller src sin master når src er en minion (pet, klone, spirit, mech):
  // README: «src_master_instid - if src_agent has a master (eg. is minion), will be equal to instid of master, zero otherwise».
  // Bare mot fiender («iff: is friend foe of enum iff», IFF_FOE = 1) og bare fra spillere («if evtc_agent.is_elite != 0xffffffff,
  // agent is a player»). Egen skade (src.self, egne minioner) telles fra chatbox-kanalen og hoppes over her. Blokk/unnvik/absorb
  // osv. gir 0 via damageOf. Kanalen er 2–3 s forsinket, så treff som kommer etter kampslutt legges på forrige kamp.
  addSquadDamage(m) {
    if (m.iff !== 1 || !m.src || !m.dst || m.src.self === 1 || m.dst.self === 1) return;
    const amt = Live.damageOf(m);
    if (!amt) return;
    let owner = m.src;
    if (m.srcMaster > 0) {
      const ownerId = this.inst.get(m.srcMaster);
      owner = ownerId != null ? this.agents.get(ownerId) : null;
      // Egen minion (pet, klone, mech, spirit): chatbox-kanalen har den ikke, så skaden legges på din egen DPS herfra,
      // med minionens skill-navn. Kommer 2–3 s forsinket som alt annet på evtc-kanalen.
      if (m.srcMaster === this.selfInst || owner?.self === 1) { this.addOwnMinionDamage(m, amt); return; }
      if (!owner) return; // ukjent eier
    }
    if (owner.elite === NPC_ELITE || !(owner.id > 0)) return; // NPC (eller NPC sin minion)
    let f = this.fight;
    if (!f) {
      // Etterslep: kampen er avsluttet i sanntid, men andres siste treff kommer 2–3 s etterpå. Legg dem på forrige kamp.
      const r = this.lastRaw;
      if (!r || m.time < r.start || m.time > r.end + 1000) return;
      f = r;
    } else if (m.time < f.start - 1000) return; // fra før vår kamp startet (forsinket): ikke vår kamp
    const name = owner.name || this.agents.get(owner.id)?.name || this.accounts.get(owner.id) || ('#' + owner.id);
    const p = f.squad.get(owner.id) || { id: owner.id, name, account: this.accounts.get(owner.id) || '', prof: owner.prof, elite: owner.elite, dmg: 0, hits: 0 };
    p.dmg += amt; p.hits++; if (owner.name) p.name = owner.name;
    f.squad.set(owner.id, p);
    if (f === this.lastRaw) this.lastFight = this.summarize(f, f.end);
    this.dirty = true;
  }
  // Egen minions skade (fra evtc-kanalen) inn i eget regnskap: total, skills, mål. Etter kampslutt legges den på forrige kamp.
  addOwnMinionDamage(m, amt) {
    let f = this.fight;
    if (!f) {
      const r = this.lastRaw;
      if (!r || m.time < r.start || m.time > r.end + 1000) return;
      f = r;
    } else if (m.time < f.start - 1000) return;
    f.total += amt;
    const tg = f.targets.get(m.dst.id) || { id: m.dst.id, name: m.dst.name || '', dmg: 0 };
    tg.dmg += amt; if (m.dst.name) tg.name = m.dst.name; f.targets.set(m.dst.id, tg);
    const label = (m.src?.name ? m.src.name + ': ' : '') + (m.name || m.skill);
    const sk = f.skills.get(m.skill) || { skill: m.skill, name: label, dmg: 0, hits: 0 };
    sk.dmg += amt; sk.hits++; f.skills.set(m.skill, sk);
    if (f === this.fight) this.dmgWindow.push([m.time, amt]);
    if (f === this.lastRaw) this.lastFight = this.summarize(f, f.end);
    this.dirty = true;
  }

  // Rangert liste: deg (fra f.total, chatbox-kanalen) og de andre i squaden, synkende. Maks 10 rader, men du er alltid med.
  // pct = andel av squadens samlede skade. Alene i kampen gir dette én rad (din egen).
  squadList(f, durationMs) {
    const rows = [{ id: this.self?.id ?? 0, name: this.self?.name || '', self: true, dmg: f.total }];
    for (const p of f.squad.values()) rows.push({ id: p.id, name: p.name, self: false, dmg: p.dmg });
    let sum = 0; for (const r of rows) sum += r.dmg;
    rows.sort((a, b) => b.dmg - a.dmg);
    const top = rows.slice(0, 10);
    if (!top.some((r) => r.self)) top[top.length - 1] = rows.find((r) => r.self);
    return top.map((r) => ({ ...r, dps: Math.round(r.dmg / durationMs * 1000), pct: sum ? Math.round(r.dmg / sum * 100) : 0 }));
  }
  summarize(f, end) {
    const durationMs = Math.max(1000, end - f.start);
    const targets = [...f.targets.values()].sort((a, b) => b.dmg - a.dmg).slice(0, 3);
    const skills = [...f.skills.values()].sort((a, b) => b.dmg - a.dmg).slice(0, 8).map((s) => ({ ...s, pct: f.total ? Math.round(s.dmg / f.total * 100) : 0 }));
    const squad = this.squadList(f, durationMs);
    const pctTaken = (s) => ({ ...s, pct: f.taken ? Math.round(s.dmg / f.taken * 100) : 0 });
    const takenBySource = [...f.takenSrc.values()].sort((a, b) => b.dmg - a.dmg).slice(0, 5).map(pctTaken);
    const takenBySkill = [...f.takenSkills.values()].sort((a, b) => b.dmg - a.dmg).slice(0, 5).map(pctTaken);
    return { durationMs, total: f.total, taken: f.taken, dps: Math.round(f.total / durationMs * 1000), targets, skills, target: targets[0]?.name || '', squad, takenBySource, takenBySkill, healing: this.healingSummary(f, durationMs) };
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
    // lastHits: de siste treffene mot deg (nyeste sist). death: frosset kopi da du gikk ned/døde. Begge beholdes til neste kampstart.
    // healing.supported = broen har meldt heal-støtte i hello, ext = healing stats-utvidelsen er lastet i spillet
    return { current: cur, last: this.lastFight, lastHits: this.lastHits.slice(), death: this.death, healing: { available: this.healSupported || this.healSeen, supported: this.healSupported, ext: this.healExt } };
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
