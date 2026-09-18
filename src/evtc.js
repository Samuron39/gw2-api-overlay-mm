'use strict';
// Minimal parser for ArcDPS EVTC/ZEVTC-logger. Regner ut skade per spiller (totalt og mot boss).
// Format: https://www.deltaconnected.com/arcdps/evtc/
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PROFESSIONS = { 1: 'Guardian', 2: 'Warrior', 3: 'Engineer', 4: 'Ranger', 5: 'Thief', 6: 'Elementalist', 7: 'Mesmer', 8: 'Necromancer', 9: 'Revenant' };
const ELITES = {
  5: 'Druid', 7: 'Daredevil', 18: 'Berserker', 27: 'Dragonhunter', 34: 'Reaper', 40: 'Chronomancer', 43: 'Scrapper', 48: 'Tempest', 52: 'Herald',
  55: 'Soulbeast', 56: 'Weaver', 57: 'Holosmith', 58: 'Deadeye', 59: 'Mirage', 60: 'Scourge', 61: 'Spellbreaker', 62: 'Firebrand', 63: 'Renegade',
  64: 'Harbinger', 65: 'Willbender', 66: 'Virtuoso', 67: 'Catalyst', 68: 'Bladesworn', 69: 'Vindicator', 70: 'Mechanist', 71: 'Specter', 72: 'Untamed',
  73: 'Luminary', 74: 'Paragon', 75: 'Conjurer', 76: 'Galeshot', 77: 'Antiquary', 78: 'Troubadour', 79: 'Evoker', 80: 'Amalgam', 81: 'Ritualist',
};

function unzipFirst(buf) {
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  if (method === 0) return buf.subarray(start, start + compSize);
  if (method === 8) return zlib.inflateRawSync(compSize ? buf.subarray(start, start + compSize) : buf.subarray(start), { maxOutputLength: 512 * 1024 * 1024 });
  throw new Error('Ukjent zip-metode ' + method);
}

function readBuffer(file) {
  if (fs.statSync(file).size > 512 * 1024 * 1024) throw new Error('EVTC-fila er større enn 512 MiB');
  const buf = fs.readFileSync(file);
  return buf.readUInt32LE(0) === 0x04034b50 ? unzipFirst(buf) : buf;
}

// Boons vi måler uptime på (skill-id i loggen)
const BOONS = { 1187: 'quickness', 30328: 'alacrity', 725: 'fury', 717: 'protection', 740: 'might' };

const AGENT_STATECHANGES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 18, 19, 20, 21, 22, 23, 24, 27, 28, 67, 68, 69, 70, 71, 72]);

// arcdps-evtc-README.txt:451–525: 67/68 er animasjon, 69 påføring (dst), 70 endring
// (dst, overstack = ny varighet), 71/72 fjerning (src). Eldre logger bruker sc=0 og buff/rem.
function eventKind(b, off) {
  const sc = b[off + 56];
  if (sc === 18 || sc === 69) return 'apply';
  if (sc === 70) return 'change';
  if (sc === 71) return 'remove';
  if (sc === 72) return 'clear';
  if (sc !== 0 || b[off + 51] !== 0) return 'other';
  if (b[off + 52]) return b[off + 52] === 1 ? 'clear' : 'remove';
  if (b[off + 49] === 1 && b.readInt32LE(off + 24) > 0) return 'apply';
  return 'damage';
}

function parse(file) {
  const b = readBuffer(file);
  if (b.toString('ascii', 0, 4) !== 'EVTC') throw new Error('Ikke en EVTC-fil');
  const build = b.toString('ascii', 4, 12);
  const revision = b[12];
  const bossId = b.readUInt16LE(13);
  let off = 16;

  const agentCount = b.readUInt32LE(off); off += 4;
  const agents = new Map();
  for (let i = 0; i < agentCount; i++) {
    const addr = b.readBigUInt64LE(off).toString();
    const prof = b.readUInt32LE(off + 8);
    const elite = b.readUInt32LE(off + 12);
    const parts = b.toString('utf8', off + 28, off + 96).split('\0');
    const a = { addr, instid: 0, masterInst: 0, name: parts[0], account: (parts[1] || '').replace(/^:/, ''), subgroup: parts[2] || '', kind: 'npc', speciesId: 0 };
    if (elite === 0xffffffff) {
      a.kind = (prof >>> 16) === 0xffff ? 'gadget' : 'npc';
      a.speciesId = prof & 0xffff;
    } else {
      a.kind = 'player';
      a.profession = PROFESSIONS[prof] || `Prof ${prof}`;
      a.spec = elite ? (ELITES[elite] || a.profession) : a.profession;
    }
    agents.set(addr, a);
    off += 96;
  }

  const skillCount = b.readUInt32LE(off); off += 4;
  off += skillCount * 68; // skillnavn trengs ikke for DPS

  const EV = 64;
  const evStart = off;
  if (off > b.length || (b.length - off) % EV) throw new Error('EVTC-fila har en ufullstendig kamphendelse');
  const evEnd = b.length;
  const byInst = new Map();

  // Pass 1: instid-koblinger, master/minion og start/slutt
  let logStart = null, logEnd = null, first = null, last = null, reward = false;
  const bossAgents = [...agents.values()].filter((a) => a.kind === 'npc' && a.speciesId === bossId);
  let bossHp = null;
  for (off = evStart; off < evEnd; off += EV) {
    const sc = b[off + 56];
    const time = Number(b.readBigUInt64LE(off));
    if (first === null) first = time;
    last = time;
    if (sc === 9) { logStart = time; continue; }
    if (sc === 10) { logEnd = time; continue; }
    if (sc === 17) { reward = true; continue; }
    if (!AGENT_STATECHANGES.has(sc)) continue;
    const a = agents.get(b.readBigUInt64LE(off + 8).toString());
    // Nyere påføring/aktivering kan være første hendelse for en spiller eller minion.
    // README:26–31: begge agentfeltene har instid/master-instid; registrer også mottakeren.
    for (const [agentOff, instOff, masterOff] of [[8, 40, 44], [16, 42, 46]]) {
      if (agentOff === 16 && sc !== 0 && sc !== 18 && (sc < 67 || sc > 72)) continue; // andre sc bruker dst til metadata
      const agent = agents.get(b.readBigUInt64LE(off + agentOff).toString());
      const inst = b.readUInt16LE(off + instOff), master = b.readUInt16LE(off + masterOff);
      if (agent && inst) {
        if (!agent.instid) { agent.instid = inst; byInst.set(inst, agent); }
        if (master && !agent.masterInst) agent.masterInst = master;
      }
    }
    if (sc === 8 && a && a.speciesId === bossId) bossHp = Number(b.readBigUInt64LE(off + 16)) / 100; // prosent
    if (sc === 4 && a && a.speciesId === bossId) bossHp = 0;
  }

  // Pass 2: skade
  const dmg = new Map();
  const add = (a, isTarget, v) => {
    const d = dmg.get(a.addr) || { all: 0, target: 0 };
    d.all += v; if (isTarget) d.target += v;
    dmg.set(a.addr, d);
  };
  const start = logStart ?? first ?? 0;
  const end = logEnd ?? last ?? start;
  // Varighetsboons bruker kø, Might har parallelle stacks. Stack-id fra pad61–64 lar
  // BUFFCHANGE/REMOVE_SINGLE treffe riktig stack (README:481,490,505). Gamle logger uten id bruker første stack.
  const boon = new Map();
  const advance = (st, time, skill) => {
    const elapsed = Math.max(0, time - st.last);
    const remaining = skill === 740 ? Math.max(0, ...st.stacks.map(s => s.ms)) : st.stacks.reduce((n, s) => n + s.ms, 0);
    st.active += Math.max(0, Math.min(time, end, st.last + remaining) - Math.max(st.last, start));
    let used = elapsed;
    for (const s of st.stacks) {
      const n = Math.min(s.ms, skill === 740 ? elapsed : used);
      s.ms -= n; if (skill !== 740) used -= n;
    }
    st.stacks = st.stacks.filter(s => s.ms > 0);
    st.last = Math.max(st.last, time);
  };
  const boonTouch = (a, skill, time, durMs, kind, id) => {
    let m = boon.get(a.addr); if (!m) { m = new Map(); boon.set(a.addr, m); }
    let st = m.get(skill); if (!st) { st = { active: 0, last: time, stacks: [] }; m.set(skill, st); }
    const removed = kind === 'remove' ? (id ? st.stacks.find(s => s.id === id) : st.stacks[0]) : null;
    advance(st, time, skill);
    const index = id ? st.stacks.findIndex(s => s.id === id) : 0;
    if (kind === 'clear') st.stacks = [];
    else if (kind === 'remove') { const i = st.stacks.indexOf(removed); if (i >= 0) st.stacks.splice(i, 1); }
    else if (kind === 'change') {
      if (index >= 0 && st.stacks[index]) st.stacks[index].ms = Math.max(0, durMs);
      else if (durMs > 0) st.stacks.push({ id, ms: durMs });
    } else if (durMs > 0) st.stacks.push({ id, ms: durMs });
  };
  for (off = evStart; off < evEnd; off += EV) {
    const kind = eventKind(b, off);
    if (kind === 'other') continue;
    const skill = b.readUInt32LE(off + 36);
    if (kind !== 'damage') {
      if (!BOONS[skill]) continue;
      const time = Number(b.readBigUInt64LE(off));
      const ownerOff = kind === 'remove' || kind === 'clear' ? 8 : 16;
      const a = agents.get(b.readBigUInt64LE(off + ownerOff).toString());
      const duration = kind === 'change' ? b.readUInt32LE(off + 32) : b.readInt32LE(off + 24);
      if (a?.kind === 'player') boonTouch(a, skill, time, duration, kind, b.readUInt32LE(off + 60));
      continue;
    }
    if (b[off + 48] !== 1) continue; // bare skade mot fiender
    const buff = b[off + 49];
    const result = b[off + 50];
    const value = b.readInt32LE(off + 24);
    const buffDmg = b.readInt32LE(off + 28);
    let v = 0;
    if (buff === 0) { if (result === 0 || result === 1 || result === 2 || result === 8 || result === 9) v = value; }
    // README:649–653: nyere buff-skade bruker 14–18; behold 0 fra eldre logger.
    else if (buff === 1 && value === 0 && buffDmg > 0 && (result === 0 || (result >= 14 && result <= 18))) v = buffDmg;
    if (v <= 0) continue;
    const src = agents.get(b.readBigUInt64LE(off + 8).toString());
    if (!src) continue;
    let owner = src;
    if (src.masterInst) owner = byInst.get(src.masterInst) || src;
    if (owner.kind !== 'player') continue;
    const dst = agents.get(b.readBigUInt64LE(off + 16).toString());
    add(owner, !!dst && dst.kind === 'npc' && dst.speciesId === bossId, v);
  }

  const durationMs = Math.max(1, end - start);
  const players = [...agents.values()].filter((a) => a.kind === 'player' && a.name).map((a) => {
    const d = dmg.get(a.addr) || { all: 0, target: 0 };
    const bm = boon.get(a.addr) || new Map();
    const boons = {};
    for (const [skill, key] of Object.entries(BOONS)) {
      const st = bm.get(Number(skill));
      if (!st) { boons[key] = 0; continue; }
      advance(st, end, Number(skill));
      boons[key] = Math.max(0, Math.min(1, st.active / durationMs));
    }
    return {
      name: a.name, account: a.account, profession: a.profession, spec: a.spec, subgroup: a.subgroup, boons,
      dmgAll: d.all, dmgTarget: d.target,
      dpsAll: Math.round(d.all / (durationMs / 1000)), dpsTarget: Math.round(d.target / (durationMs / 1000)),
    };
  }).sort((x, y) => y.dpsTarget - x.dpsTarget || y.dpsAll - x.dpsAll);

  const st = fs.statSync(file);
  return {
    file, build, revision, bossId,
    // Åpen verden: ArcDPS logger hele kartet, id-en er da kart-id og ingen agent har den som art. Mappenavnet
    // («Deeper Revelations Leyspring Hollows (1640)») er det eneste lesbare navnet. Målt i eierens to logger 18. sept 2026.
    boss: bossAgents[0]?.name || folderTitle(file, bossId) || `Boss ${bossId}`,
    hasTarget: bossAgents.length > 0,
    success: reward || bossHp === 0,
    bossHpEnd: bossHp,
    durationMs,
    when: st.mtimeMs,
    players,
    totalDpsTarget: players.reduce((s, p) => s + p.dpsTarget, 0),
    totalDpsAll: players.reduce((s, p) => s + p.dpsAll, 0),
  };
}

// «<navn> (<id>)» fra mappa ArcDPS la loggen i, uten id-en. Tom streng når mappa ikke følger det mønsteret.
function folderTitle(file, id) {
  const m = /^(.+?)\s*\((\d+)\)$/.exec(path.basename(path.dirname(file)));
  return m && Number(m[2]) === id ? m[1].trim() : '';
}

module.exports = { parse, folderTitle };
