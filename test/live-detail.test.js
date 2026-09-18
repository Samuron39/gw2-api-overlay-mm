'use strict';
// Spillerliste og detaljer til DPS-meteret: live.detail({ period, player, target }). Regnskapet føres per spiller, per mål
// og per skill fra de samme hendelsene som total/squad, så summene må stemme overens. Mater live.handle() direkte (ingen UDP).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const live = require('../src/live');

const NPC = 0xffffffff;
const SELF = { id: 100, name: 'Alfa', prof: 2, elite: 74, self: 1, team: 1 };
const BETA = { id: 101, name: 'Beta', prof: 4, elite: 55, self: 0, team: 1 };
const GAMMA = { id: 102, name: 'Gamma', prof: 6, elite: 0, self: 0, team: 1 };
const PET = { id: 300, name: 'Juvenile Jaguar', prof: 0x2222, elite: NPC, self: 0, team: 1 };
const GOLEM = { id: 200, name: 'Golem', prof: 0x1234, elite: NPC, self: 0, team: 2 };
const TRASH = { id: 201, name: 'Trash', prof: 0x0777, elite: NPC, self: 0, team: 2 };

let seq = 0;
const ev = (o = {}) => ({ t: 'ev', s: 'local', id: ++seq, time: 0, skill: 0, name: '', value: 0, buffDmg: 0, overstack: 0, iff: 1, buff: 0, result: 0, act: 0, rem: 0, sc: 0, srcInst: 0, dstInst: 0, srcMaster: 0, dstMaster: 0, src: SELF, dst: null, ...o });
const area = (o) => ev({ s: 'area', ...o });
const heal = (o) => ({ t: 'heal', ch: 'local', id: ++seq, time: 0, skill: 0, name: '', value: 0, over: 0, barrier: 0, buff: 0, iff: 0, srcInst: 0, dstInst: 0, srcMaster: 0, dstMaster: 0, src: SELF, dst: SELF, ...o });

// Én kamp på 10 s: du, Beta (med pet) og Gamma mot Golem og Trash
function fight(t0, { end = true } = {}) {
  const msgs = [
    ev({ time: t0, sc: 1, srcInst: 5400 }),
    ev({ time: t0 + 100, dst: GOLEM, value: -1000, skill: 10, name: 'Slag', srcInst: 5400 }),
    ev({ time: t0 + 200, dst: TRASH, value: -400, skill: 10, name: 'Slag', srcInst: 5400 }),
    ev({ time: t0 + 300, dst: GOLEM, buff: 1, buffDmg: -250, skill: 736, name: 'Bleeding', srcInst: 5400 }),
    area({ time: t0 + 150, src: BETA, srcInst: 7101, dst: GOLEM, value: 3000, skill: 20, name: 'Pil', result: 1 }),
    area({ time: t0 + 250, src: BETA, srcInst: 7101, dst: GOLEM, buff: 1, buffDmg: 500, skill: 736, name: 'Bleeding', result: 14 }),
    area({ time: t0 + 350, src: PET, srcInst: 7300, srcMaster: 7101, dst: GOLEM, value: 700, skill: 30, name: 'Bitt' }),
    area({ time: t0 + 450, src: GAMMA, srcInst: 7102, dst: TRASH, value: 800, skill: 40, name: 'Ild' }),
    area({ time: t0 + 460, src: BETA, srcInst: 7101, dst: GOLEM, value: 999, skill: 20, name: 'Pil', result: 3 }), // blokkert
    ev({ time: t0 + 500, src: GOLEM, dst: SELF, value: -600, skill: 50, name: 'Bitt' }), // mottatt
    heal({ time: t0 + 600, value: 300, skill: 60, name: 'Signet' }),
    { ...heal({ time: t0 + 700, value: 1200, skill: 70, name: 'Spring', src: BETA, dst: BETA }), ch: 'ext' },
  ];
  if (end) msgs.push(ev({ time: t0 + 10000, sc: 2 }));
  for (const m of msgs) live.handle(m);
}

test.beforeEach(() => { live.reset(); live.resetSession(); });
test.after(() => live.reset());

test('spillerlista: rangert på skade med andel, DPS, healing og HPS; du er alltid med; summene er de samme som i snapshot', () => {
  fight(1_000_000);
  const d = live.detail({ period: 'last' });
  assert.equal(d.empty, false); assert.equal(d.durationMs, 10000); assert.equal(d.active, false);
  assert.deepEqual(d.players.map((p) => [p.rank, p.name, p.self, p.dmg, p.dps, p.pct, p.heal, p.hps]), [
    [1, 'Beta', false, 4200, 420, 63, 1200, 120],
    [2, 'Alfa', true, 1650, 165, 25, 300, 30],
    [3, 'Gamma', false, 800, 80, 12, 0, 0],
  ]);
  assert.equal(d.total, 6650); assert.equal(d.dps, 665);
  assert.deepEqual([d.players[0].prof, d.players[0].elite], [4, 55], 'profesjon følger med til lista');
  // samme tall som den faste strømmen viser
  const last = live.snapshot().dps.last;
  assert.equal(last.total, 1650);
  assert.deepEqual(last.squad.map((p) => [p.name, p.dmg]), d.players.map((p) => [p.name, p.dmg]));
  // mål i perioden, på tvers av spillere
  assert.deepEqual(d.targets.map((t) => [t.name, t.dmg, t.pct]), [['Golem', 5450, 82], ['Trash', 1200, 18]]);
  assert.equal(d.player, null, 'ingen detaljer uten at en spiller er valgt');
});

test('alene uten skade: lista har bare deg, og tom periode gir empty', () => {
  assert.equal(live.detail({ period: 'fight' }).empty, true);
  assert.equal(live.detail({ period: 'session' }).empty, true);
  live.handle(ev({ time: 5000, sc: 1 }));
  const d = live.detail({ period: 'fight' });
  assert.equal(d.active, true);
  assert.deepEqual(d.players.map((p) => [p.name, p.self, p.dmg]), [['Alfa', true, 0]]);
});

test('detaljer for en annen spiller: skills (minion under eieren med navn foran), mål, ingen mottatt-seksjon', () => {
  fight(1_000_000);
  const p = live.detail({ period: 'last', player: BETA.id }).player;
  assert.equal(p.name, 'Beta'); assert.equal(p.dmg, 4200); assert.equal(p.rank, 1);
  assert.deepEqual(p.skills.map((s) => [s.name, s.dmg, s.hits, s.pct]), [['Pil', 3000, 1, 71], ['Juvenile Jaguar: Bitt', 700, 1, 17], ['Bleeding', 500, 1, 12]]);
  assert.deepEqual(p.targets.map((t) => [t.name, t.dmg, t.pct]), [['Golem', 4200, 100]]);
  assert.equal(p.taken, undefined); assert.equal(p.heal, 1200);
  assert.equal(live.detail({ period: 'last', player: 999 }).player, null, 'ukjent spiller');
});

test('detaljer for deg selv: skills, mål, mottatt per kilde og healing per skill', () => {
  fight(1_000_000);
  const p = live.detail({ period: 'last', player: 'self' }).player;
  assert.deepEqual(p.skills.map((s) => [s.name, s.dmg, s.hits]), [['Slag', 1400, 2], ['Bleeding', 250, 1]]);
  assert.deepEqual(p.targets.map((t) => [t.name, t.dmg, t.pct]), [['Golem', 1250, 76], ['Trash', 400, 24]]);
  assert.equal(p.taken, 600); assert.deepEqual(p.takenBySource.map((s) => [s.name, s.dmg, s.pct]), [['Golem', 600, 100]]);
  assert.deepEqual(p.healBySkill.map((s) => [s.name, s.heal, s.pct]), [['Signet', 300, 100]]);
});

test('målfilter: ett mål eller nåværende mål; lista, andelene og skills følger valget, 0 mot målet beholdes i lista', () => {
  fight(1_000_000, { end: false });
  let d = live.detail({ period: 'fight', target: TRASH.id, player: BETA.id });
  assert.deepEqual(d.target, { id: TRASH.id, name: 'Trash' });
  assert.deepEqual(d.players.map((p) => [p.name, p.dmg, p.pct]), [['Gamma', 800, 67], ['Alfa', 400, 33], ['Beta', 0, 0]]);
  assert.equal(d.player.dmg, 0); assert.deepEqual(d.player.skills, []);
  assert.equal(d.player.targets.length, 1, 'mål-lista for spilleren viser fortsatt alt hun har truffet');
  // nåværende mål: siste vi traff var Golem (condition-ticken)
  assert.equal(live.targetId, GOLEM.id);
  d = live.detail({ period: 'fight', target: 'current', player: 'self' });
  assert.equal(d.target.name, 'Golem'); assert.equal(d.currentTargetId, GOLEM.id);
  assert.deepEqual(d.players.map((p) => [p.name, p.dmg]), [['Beta', 4200], ['Alfa', 1250], ['Gamma', 0]]);
  assert.deepEqual(d.player.skills.map((s) => [s.name, s.dmg]), [['Slag', 1000], ['Bleeding', 250]]);
  assert.deepEqual(d.targets.map((t) => [t.name, t.current]), [['Golem', true], ['Trash', false]]);
  // intet mål valgt i spillet: «nåværende» gir tom liste med 0, ikke alt
  live.clearTarget();
  d = live.detail({ period: 'fight', target: 'current' });
  assert.deepEqual(d.target, { id: null, name: '' }); assert.ok(d.players.every((p) => p.dmg === 0));
});

test('hele økta: to kamper slås sammen per spiller, mål og skill, også etter at den første er foldet inn', () => {
  fight(1_000_000);
  fight(1_020_000);
  assert.equal(live.lastRaw.folded, undefined); assert.ok(live.sessionBase, 'første kamp er foldet inn i økta');
  const d = live.detail({ period: 'session', player: BETA.id });
  assert.equal(d.fights, 2); assert.equal(d.durationMs, 20000);
  assert.deepEqual(d.players.map((p) => [p.name, p.dmg, p.dps, p.heal]), [['Beta', 8400, 420, 2400], ['Alfa', 3300, 165, 600], ['Gamma', 1600, 80, 0]]);
  assert.deepEqual(d.player.skills.map((s) => [s.name, s.dmg, s.hits]), [['Pil', 6000, 2], ['Juvenile Jaguar: Bitt', 1400, 2], ['Bleeding', 1000, 2]]);
  assert.equal(live.snapshot().dps.session.total, 3300);
  // forrige kamp alene er fortsatt bare den siste
  assert.equal(live.detail({ period: 'last' }).players[0].dmg, 4200);
});

test('ekte opptak: detaljene for deg selv summerer til samme tall som økta, fordelt på mål', () => {
  const file = path.join(__dirname, 'fixtures', 'live-condi-2026-09-18.jsonl.gz');
  for (const line of zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n')) { const i = line.indexOf('{'); if (i >= 0) live.handle(JSON.parse(line.slice(i))); }
  if (live.fight) live.endFight(live.fight.last);
  const d = live.detail({ period: 'session', player: 'self' });
  assert.equal(d.players.length, 1); assert.equal(d.players[0].name, 'Testkarakter');
  assert.equal(d.players[0].dmg, 278357); assert.equal(d.total, 278357); assert.equal(d.fights, 7);
  assert.deepEqual(d.player.skills.slice(0, 2).map((s) => [s.name, s.dmg]), [['Bleeding', 75300], ['Torment', 59619]]);
  assert.equal(d.targets.reduce((n, t) => n + t.dmg, 0) <= 278357, true);
  assert.ok(d.targets.length > 3 && d.targets.every((t) => t.name), 'alle mål har navn');
  // ett mål: spillerens skade mot det er lik målets samlede skade (solo)
  const top = d.targets[0];
  assert.equal(live.detail({ period: 'session', target: top.id }).players[0].dmg, top.dmg);
});
