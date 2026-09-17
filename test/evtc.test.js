'use strict';
// Tester for EVTC-parseren i src/evtc.js med en syntetisk logg bygd byte for byte.
// Format: https://www.deltaconnected.com/arcdps/evtc/ (header 16, agent 96, skill 68, hendelse 64 byte).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { parse } = require('../src/evtc');

const BOSS_ID = 15438;
const AGENT = 96, SKILL = 68, EV = 64;
const NPC = 0xffffffff;

// Agent-adresser (u64 i loggen)
const ALFA = 1001, BETA = 1002, GAMMA = 1004, PET = 1003, BOSS = 2000, TRASH = 3000;
// instid-er (tildeles via statechange-hendelser)
const INST = { [ALFA]: 10, [BETA]: 11, [GAMMA]: 12, [PET]: 13, [BOSS]: 20, [TRASH]: 21 };

function agent({ addr, prof, elite, name }) {
  const b = Buffer.alloc(AGENT);
  b.writeBigUInt64LE(BigInt(addr), 0);
  b.writeUInt32LE(prof, 8);
  b.writeUInt32LE(elite, 12);
  b.write(name, 28, 68, 'utf8');
  return b;
}

function ev(o) {
  const b = Buffer.alloc(EV);
  b.writeBigUInt64LE(BigInt(o.time ?? 0), 0);
  b.writeBigUInt64LE(BigInt(o.src ?? 0), 8);
  b.writeBigUInt64LE(BigInt(o.dst ?? 0), 16);
  b.writeInt32LE(o.value ?? 0, 24);
  b.writeInt32LE(o.buffDmg ?? 0, 28);
  b.writeUInt32LE(o.overstack ?? 0, 32);
  b.writeUInt32LE(o.skill ?? 0, 36);
  b.writeUInt16LE(o.srcInst ?? (o.src ? INST[o.src] || 0 : 0), 40);
  b.writeUInt16LE(o.dstInst ?? 0, 42);
  b.writeUInt16LE(o.srcMaster ?? 0, 44);
  b.writeUInt16LE(o.dstMaster ?? 0, 46);
  b[48] = o.iff ?? 2;      // 0 venn, 1 fiende, 2 ukjent
  b[49] = o.buff ?? 0;
  b[50] = o.result ?? 0;   // 0 normal, 1 crit, 2 glance, 3 block
  b[51] = o.act ?? 0;      // is_activation
  b[52] = o.rem ?? 0;      // is_buffremove
  b[56] = o.sc ?? 0;       // is_statechange
  b.writeUInt32LE(o.stack ?? 0, 60); // nyere buffs: pad61–64 er trackable stack-id
  return b;
}

/**
 * Bygger en logg på 10 sekunder (1000 → 11000 ms) med to spillere som gjør skade, en tredje som ikke gjør noe,
 * et kjæledyr eid av Beta, bossen og en trash-mob.
 */
function buildLog({ death = true, reward = false, hpUpdate = true } = {}) {
  const head = Buffer.alloc(16);
  head.write('EVTC', 0, 'ascii');
  head.write('20260912', 4, 'ascii');
  head[12] = 1; // revisjon
  head.writeUInt16LE(BOSS_ID, 13);

  // Navnefeltet er "karakter\0:konto\0undergruppe\0" i ekte logger
  const agents = [
    agent({ addr: ALFA, prof: 1, elite: 62, name: 'Alfa\0:Alfa.1234\x001\0' }),        // Guardian / Firebrand
    agent({ addr: BETA, prof: 4, elite: 55, name: 'Beta\0:Beta.5678\x001\0' }),        // Ranger / Soulbeast
    agent({ addr: GAMMA, prof: 8, elite: 0, name: 'Gamma\0:Gamma.0001\x002\0' }),      // Necromancer uten elite
    agent({ addr: PET, prof: 0x1234, elite: NPC, name: 'Jaguar' }),              // npc, art 0x1234
    agent({ addr: BOSS, prof: BOSS_ID, elite: NPC, name: 'Golem' }),
    agent({ addr: TRASH, prof: 0x0777, elite: NPC, name: 'Trash' }),
  ];
  const agentCount = Buffer.alloc(4); agentCount.writeUInt32LE(agents.length, 0);
  const skillCount = Buffer.alloc(4); skillCount.writeUInt32LE(1, 0);
  const skill = Buffer.alloc(SKILL); skill.writeUInt32LE(1187, 0); skill.write('Quickness', 4, 'utf8');

  const events = [
    ev({ sc: 9, time: 1000 }), // loggstart
    // instid-registrering via "enter combat"; kjæledyret peker på Beta som eier
    ev({ sc: 1, time: 1000, src: ALFA }),
    ev({ sc: 1, time: 1000, src: BETA }),
    ev({ sc: 1, time: 1000, src: GAMMA }),
    ev({ sc: 1, time: 1000, src: PET, srcMaster: INST[BETA] }),
    ev({ sc: 1, time: 1000, src: BOSS }),
    ev({ sc: 1, time: 1000, src: TRASH }),
    // boon på Beta fra start: fury i 5 s av 10 → 0.5
    ev({ time: 1000, src: BETA, dst: BETA, value: 5000, buff: 1, skill: 725, iff: 0 }),
    // direkte skade fra Alfa mot bossen
    ev({ time: 2000, src: ALFA, dst: BOSS, value: 5000, skill: 100, iff: 1, result: 0 }),
    ev({ time: 2500, src: ALFA, dst: BOSS, value: 3000, skill: 100, iff: 1, result: 1 }),   // crit
    ev({ time: 2600, src: ALFA, dst: BOSS, value: 9999, skill: 100, iff: 1, result: 3 }),   // blokkert, teller ikke
    ev({ time: 2700, src: ALFA, dst: BETA, value: 700, skill: 100, iff: 0, result: 0 }),    // vennlig treff, teller ikke
    ev({ time: 2800, src: ALFA, dst: TRASH, value: 1000, skill: 100, iff: 1, result: 0 }),  // cleave: totalt, ikke boss
    ev({ time: 2900, src: ALFA, dst: BOSS, value: 5000, skill: 100, iff: 1, act: 1 }),      // aktivering, ikke skade
    // quickness på Alfa: påført 3000 for 4 s, alle stacks fjernet ved 5000 → 2 s av 10 → 0.2
    ev({ time: 3000, src: BETA, dst: ALFA, value: 4000, buff: 1, skill: 1187, iff: 0 }),
    ev({ time: 5000, src: ALFA, dst: BETA, buff: 1, skill: 1187, rem: 1 }),
    // condition-skade fra Beta mot bossen
    ev({ time: 3000, src: BETA, dst: BOSS, value: 0, buffDmg: 1500, buff: 1, skill: 736, iff: 1, result: 0 }),
    // kjæledyrets skade tilskrives Beta
    ev({ time: 3500, src: PET, dst: BOSS, value: 800, skill: 101, iff: 1, result: 0 }),
  ];
  if (hpUpdate) events.push(ev({ time: 6000, sc: 8, src: BOSS, dst: 2500 })); // 25.00 %
  if (death) events.push(ev({ time: 10000, sc: 4, src: BOSS }));
  if (reward) events.push(ev({ time: 10500, sc: 17 }));
  events.push(ev({ sc: 10, time: 11000 })); // loggslutt

  return Buffer.concat([head, agentCount, ...agents, skillCount, skill, ...events]);
}

// Manuell zip med én fil (lokal filheader + data). method 8 = deflate, 0 = lagret.
function zipOne(raw, name, method) {
  const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
  const nameBuf = Buffer.from(name, 'ascii');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);              // versjon
  h.writeUInt16LE(0, 6);               // flagg
  h.writeUInt16LE(method, 8);
  h.writeUInt16LE(0, 10); h.writeUInt16LE(0, 12); // tid, dato
  h.writeUInt32LE(0, 14);              // crc32 (parseren sjekker ikke)
  h.writeUInt32LE(data.length, 18);
  h.writeUInt32LE(raw.length, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, nameBuf, data]);
}

let dir;
test.before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-evtc-')); });
test.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function write(name, buf) { const f = path.join(dir, name); fs.writeFileSync(f, buf); return f; }
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

function sjekkStandardLogg(r) {
  assert.equal(r.build, '20260912');
  assert.equal(r.revision, 1);
  assert.equal(r.bossId, BOSS_ID);
  assert.equal(r.boss, 'Golem');
  assert.equal(r.durationMs, 10000);
  assert.equal(r.players.length, 3);

  const [alfa, beta, gamma] = r.players;
  assert.equal(alfa.name, 'Alfa');
  assert.equal(alfa.account, 'Alfa.1234', 'kolon foran kontonavnet fjernes');
  assert.equal(alfa.subgroup, '1');
  assert.equal(alfa.profession, 'Guardian');
  assert.equal(alfa.spec, 'Firebrand');
  assert.equal(alfa.dmgTarget, 8000, 'normal + crit, blokkert og aktivering ikke medregnet');
  assert.equal(alfa.dmgAll, 9000, 'cleave mot trash teller totalt, vennlig treff gjør det ikke');
  assert.equal(alfa.dpsTarget, 800);
  assert.equal(alfa.dpsAll, 900);

  assert.equal(beta.name, 'Beta');
  assert.equal(beta.spec, 'Soulbeast');
  assert.equal(beta.dmgTarget, 2300, 'condition 1500 + kjæledyr 800');
  assert.equal(beta.dmgAll, 2300);
  assert.equal(beta.dpsTarget, 230);

  assert.equal(gamma.name, 'Gamma');
  assert.equal(gamma.subgroup, '2');
  assert.equal(gamma.profession, 'Necromancer');
  assert.equal(gamma.spec, 'Necromancer', 'uten elite-spec brukes profesjonen');
  assert.equal(gamma.dmgAll, 0);

  assert.equal(r.totalDpsTarget, 1030);
  assert.equal(r.totalDpsAll, 1130);
}

test('rå EVTC: skade, condition, kjæledyr→eier, blokkert og vennlig treff', () => {
  const r = parse(write('a.evtc', buildLog()));
  sjekkStandardLogg(r);
  assert.equal(r.success, true);
  assert.equal(r.bossHpEnd, 0);
  assert.ok(r.when > 0, 'when kommer fra filas mtime');
});

test('boon-uptime: påføring med varighet og fjerning av alle stacks', () => {
  const r = parse(write('b.evtc', buildLog()));
  const alfa = r.players.find((p) => p.name === 'Alfa');
  const beta = r.players.find((p) => p.name === 'Beta');
  near(alfa.boons.quickness, 0.2, 'Alfa quickness');
  near(beta.boons.fury, 0.5, 'Beta fury');
  near(alfa.boons.fury, 0, 'Alfa fury');
  near(beta.boons.quickness, 0, 'Beta quickness');
  for (const key of ['quickness', 'alacrity', 'fury', 'protection', 'might']) assert.ok(key in alfa.boons, key);
});

function eventOffset(b) {
  const skills = 20 + b.readUInt32LE(16) * AGENT;
  return skills + 4 + b.readUInt32LE(skills) * SKILL;
}

test('nyere EVTC: 67–72 og buff-resultat 14–18 gir samme kamp som eldre format', () => {
  for (const result of [14, 15, 16, 17, 18]) {
    const b = buildLog();
    for (let off = eventOffset(b); off < b.length; off += EV) {
      if (b[off + 49] === 1 && b.readInt32LE(off + 28) > 0) b[off + 50] = result;
      if (b[off + 49] === 1 && b.readInt32LE(off + 24) > 0) { b[off + 56] = 69; b[off + 49] = 0; }
      if (b[off + 52] === 1) { b[off + 56] = 72; b[off + 52] = 0; b[off + 49] = 0; }
      if (b[off + 51]) { b[off + 56] = 67; b[off + 51] = 0; }
    }
    const r = parse(write(`modern-${result}.evtc`, b));
    sjekkStandardLogg(r);
    near(r.players[0].boons.quickness, 0.2, 'Quickness');
    near(r.players[1].boons.fury, 0.5, 'Fury');
  }
});

test('nyere buff-initial/change/single-remove bruker riktig mottaker og stack-id', () => {
  const base = buildLog();
  const header = base.subarray(0, eventOffset(base));
  const events = [
    ev({ sc: 9, time: 1000 }),
    ev({ sc: 18, time: 1000, src: BETA, dst: ALFA, value: 5000, buffDmg: 10000, skill: 740, stack: 10 }),
    ev({ sc: 69, time: 1000, src: BETA, dst: ALFA, value: 3000, skill: 740, stack: 11 }),
    ev({ sc: 70, time: 2000, dst: ALFA, value: -3000, overstack: 1000, skill: 740, stack: 10 }),
    ev({ sc: 71, time: 2500, src: ALFA, dst: BETA, value: 1500, skill: 740, stack: 11 }),
    ev({ sc: 10, time: 11000 }),
  ];
  const r = parse(write('modern-stacks.evtc', Buffer.concat([header, ...events])));
  near(r.players.find(p => p.name === 'Alfa').boons.might, 0.2, 'Might aktiv 1000–3000');
  near(r.players.find(p => p.name === 'Beta').boons.might, 0, 'Avsender får ikke buffen');
});

test('boss-utfall: uten død brukes siste HP-oppdatering, reward-event teller som seier', () => {
  const levende = parse(write('c.evtc', buildLog({ death: false })));
  assert.equal(levende.success, false);
  assert.equal(levende.bossHpEnd, 25);
  const ukjent = parse(write('d.evtc', buildLog({ death: false, hpUpdate: false })));
  assert.equal(ukjent.success, false);
  assert.equal(ukjent.bossHpEnd, null);
  const reward = parse(write('e.evtc', buildLog({ death: false, reward: true })));
  assert.equal(reward.success, true);
  assert.equal(reward.bossHpEnd, 25);
});

test('.zevtc: zip med deflate og manuell lokal filheader gir samme resultat', () => {
  const raw = buildLog();
  const r = parse(write('f.zevtc', zipOne(raw, '20260912-120000.evtc', 8)));
  sjekkStandardLogg(r);
  assert.equal(r.success, true);
});

test('.zevtc: zip med lagret (ukomprimert) fil', () => {
  const raw = buildLog();
  const r = parse(write('g.zevtc', zipOne(raw, 'x.evtc', 0)));
  sjekkStandardLogg(r);
});

test('fil som ikke er EVTC avvises', () => {
  const f = write('h.evtc', Buffer.from('Dette er ikke en logg'));
  assert.throws(() => parse(f), /Ikke en EVTC-fil/);
  const z = write('i.zevtc', zipOne(Buffer.from('heller ikke dette'), 'x.evtc', 8));
  assert.throws(() => parse(z), /Ikke en EVTC-fil/);
});

test('logg uten start/slutt-hendelser bruker første og siste tidsstempel', () => {
  // fjern statechange 9 og 10 ved å bygge en minimal logg selv
  const head = Buffer.alloc(16); head.write('EVTC', 0, 'ascii'); head.write('20260912', 4, 'ascii'); head[12] = 1; head.writeUInt16LE(BOSS_ID, 13);
  const ac = Buffer.alloc(4); ac.writeUInt32LE(2, 0);
  const sc = Buffer.alloc(4); sc.writeUInt32LE(0, 0);
  const buf = Buffer.concat([
    head, ac,
    agent({ addr: ALFA, prof: 2, elite: 18, name: 'Alfa\0:Alfa.1234\x001\0' }),
    agent({ addr: BOSS, prof: BOSS_ID, elite: NPC, name: 'Golem' }),
    sc,
    ev({ sc: 1, time: 500, src: ALFA }),
    ev({ time: 500, src: ALFA, dst: BOSS, value: 2000, skill: 1, iff: 1 }),
    ev({ time: 4500, src: ALFA, dst: BOSS, value: 2000, skill: 1, iff: 1 }),
  ]);
  const r = parse(write('j.evtc', buf));
  assert.equal(r.durationMs, 4000);
  assert.equal(r.players[0].spec, 'Berserker');
  assert.equal(r.players[0].dpsTarget, 1000);
});
