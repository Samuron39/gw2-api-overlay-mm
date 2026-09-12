'use strict';
// Live-tilstand fra ArcDPS-broen (UDP 127.0.0.1:47500): buffs på deg, conditions på målet, cooldowns.
const dgram = require('dgram');
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
    this.timer = null;
    this.dirty = false;
    this.lastJsonWarn = 0; // maks én JSON-advarsel per 10 s
    // Tellere for statuslinja. Tap oppdages ved hopp i broens løpenummer "n" (fallback: arcdps-id for lokale hendelser)
    this.stats = { packets: 0, events: 0, dropsDetected: 0 };
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
      if (this.dirty) { this.dirty = false; this.emit('update', this.snapshot()); }
    }, 100);
  }

  stop() { clearInterval(this.timer); this.timer = null; this.socket?.close(); this.socket = null; }

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
      return;
    }
    if (m.t !== 'agent' && m.t !== 'ev') return;
    this.stats.events++;
    this.trackSeq(m);
    if (m.t === 'agent') {
      // Målbytte: src.elite = 0xffffffff og src.id = det nye målet. ArcDPS sender dst = null her (eldre bro: dst.self = 1).
      if (m.src && m.src.elite === NPC_ELITE && m.src.id > 0 && (m.dst == null || m.dst.self === 1)) {
        if (!this.agents.has(m.src.id)) this.agents.set(m.src.id, { id: m.src.id, name: m.src.name || '', prof: m.src.prof, elite: m.src.elite, self: 0 });
        if (this.targetId !== m.src.id) { this.targetId = m.src.id; this.dirty = true; }
        return;
      }
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
    this.offset = Date.now() - m.time;
    const srcSelf = m.src?.self === 1;
    if (m.src?.name) this.agents.set(m.src.id, { id: m.src.id, name: m.src.name, prof: m.src.prof, elite: m.src.elite, self: m.src.self });
    if (m.dst?.name) this.agents.set(m.dst.id, { id: m.dst.id, name: m.dst.name, prof: m.dst.prof, elite: m.dst.elite, self: m.dst.self });
    if (srcSelf && !this.self) this.self = { id: m.src.id, name: m.src.name, prof: m.src.prof, elite: m.src.elite };

    if (m.sc === 1 && srcSelf) { this.inCombat = true; this.dirty = true; return; }
    if (m.sc === 2 && srcSelf) { this.inCombat = false; this.targetId = null; this.dirty = true; return; }
    if (m.sc === 11 && srcSelf) { const v = Number(m.dstAgent); this.weaponSet = v === 5 ? 'B' : v === 4 ? 'A' : v === 1 ? 'W2' : v === 0 ? 'W1' : this.weaponSet; this.dirty = true; return; }
    // sc 18 (CBTS_BUFFINITIAL): buffs som allerede ligger på agenten ved oppstart eller kartbytte. Samme felt som en påføring.
    if (m.sc === 18) { this.applyBuff(m, false); return; }
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

    // Skade fra oss mot fiende: husk målet
    if (srcSelf && m.iff === 1 && m.dst && (m.value > 0 || m.buffDmg > 0)) {
      if (this.targetId !== m.dst.id) { this.targetId = m.dst.id; this.dirty = true; }
    }
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
    return {
      connected: this.connected, arcVersion: this.arcVersion, inCombat: this.inCombat, weaponSet: this.weaponSet,
      self: this.self, buffs: this.buffList(this.buffs),
      target: target ? { id: target.id, name: target.name, buffs: tmap ? this.buffList(tmap) : [] } : null,
      cooldowns, arcNow: now,
      stats: { ...this.stats },
    };
  }
}

module.exports = new Live();
