'use strict';
// Avspilling av et EKTE opptak gjennom live.handle(): eierens 3 minutter med condition-warrior 18. sept 2026
// (ArcDPS 20260915, solo i åpen verden, 7 kamper). Anonymisert med scripts/anonymize-recording.js.
// Låser det opptaket avgjorde: egne condition-ticks (buff 1, NEGATIV buffDmg, iff 1, result 0) er skade, positive
// verdier med iff 0 er healing, og dødsstøt (value 0, result 8) tømmer målet. Summene er telt uavhengig fra linjene.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const live = require('../src/live');
const { anonymize } = require('../scripts/anonymize-recording');

const FIXTURE = path.join(__dirname, 'fixtures', 'live-condi-2026-09-18.jsonl.gz');
const NPC = 0xffffffff;

function messages() {
  const out = [];
  for (const line of zlib.gunzipSync(fs.readFileSync(FIXTURE)).toString('utf8').split('\n')) {
    const i = line.indexOf('{');
    if (i >= 0) out.push(JSON.parse(line.slice(i)));
  }
  return out;
}

test('ekte opptak: uavhengig opptelling av linjene gir de samme summene som live.js', () => {
  const msgs = messages();
  // Uavhengig opptelling rett fra linjene, uten live.js
  let own = 0, condi = 0, taken = 0, healed = 0, killingBlows = 0;
  for (const m of msgs) {
    if (m.t === 'heal' && m.ch === 'local' && m.src?.self === 1) healed += m.value;
    if (m.t !== 'ev' || m.s !== 'local' || m.sc !== 0) continue;
    const amount = Math.abs(m.buff === 1 ? m.buffDmg : m.value);
    if (m.src?.self === 1 && m.iff === 1) { own += amount; if (m.buff === 1) { condi += amount; assert.ok(m.buffDmg < 0, 'egen condition-tick er negativ'); assert.equal(m.result, 0); } }
    else if (m.dst?.self === 1 && m.src?.self !== 1) taken += amount;
    if (m.result === 8 && m.src?.self === 1) { killingBlows++; assert.equal(m.value, 0); assert.equal(m.buffDmg, 0); }
  }
  assert.deepEqual({ own, condi, taken, healed, killingBlows }, { own: 278357, condi: 134919, taken: 16542, healed: 22049, killingBlows: 5 });

  live.reset();
  live.resetSession();
  for (const m of msgs) {
    live.handle(m);
    // dødsstøtet tømmer målet i samme øyeblikk (fase 1 pkt. 2), ikke først ved kampslutt
    if (m.t === 'ev' && m.result === 8 && m.src?.self === 1) assert.notEqual(live.targetId, m.dst.id, 'målet tømt ved dødsstøt');
  }
  if (live.fight) live.endFight(live.fight.last);
  const s = live.snapshot().dps.session;
  assert.equal(s.total, own, 'egen skade, direkte og condition');
  assert.equal(s.taken, taken);
  assert.equal(s.healing.done, healed);
  assert.equal(s.fights, 7);
  const skill = (name) => s.skills.find((k) => k.name === name)?.dmg;
  assert.equal(skill('Bleeding'), 75300); assert.equal(skill('Torment'), 59619);
  assert.equal(skill('Bleeding') + skill('Torment'), condi, 'all condition-skade er Bleeding og Torment');
  assert.equal(skill('Sever Artery'), 40499);
  // condition-ticks er ikke telt som healing, og healing er ikke telt som skade
  const healNames = s.healing.bySkill.map((k) => k.name);
  assert.ok(!healNames.includes('Bleeding') && !healNames.includes('Torment'), 'ingen condition i healing: ' + healNames.join(', '));
  assert.ok(healNames.includes('Regeneration'));
  assert.ok(!s.skills.some((k) => k.name === 'Regeneration' || k.name === 'Chant of Recuperation'), 'ingen healing i skade');
  assert.equal(live.snapshot().self.name, 'Testkarakter');
  live.reset();
});

test('ekte opptak: fixturen inneholder ingen spiller- eller kontonavn', () => {
  const names = new Set();
  for (const m of messages()) for (const side of ['src', 'dst']) { const a = m[side]; if (a?.name && a.elite !== NPC) names.add(a.name); }
  assert.deepEqual([...names], ['Testkarakter']);
  assert.ok(!/\.\d{4}"/.test(zlib.gunzipSync(fs.readFileSync(FIXTURE)).toString('utf8')), 'ingen kontonavn (navn.1234)');
});

test('anonymisering: spillere og konti byttes, NPC-er og tall beholdes, lekk oppdages', () => {
  const me = { id: 1, name: 'Ekte Navn', prof: 2, elite: 74, self: 1, team: 1 };
  const other = { id: 2, name: 'Annen Spiller', prof: 1, elite: 0, self: 0, team: 1 };
  const npc = { id: 3, name: 'Wild Wavehawk', prof: 4660, elite: NPC, self: 0, team: 2 };
  const lines = [
    '# GW2 Overlay live-opptak',
    '1\t' + JSON.stringify({ t: 'agent', s: 'area', src: { id: 1, name: 'Ekte Navn', prof: 1, elite: 0 }, dst: { id: 5400, name: ':ekte.1234', prof: 2, elite: 74, self: 1 } }),
    '2\t' + JSON.stringify({ t: 'ev', s: 'local', sc: 0, value: -500, src: me, dst: npc, name: 'Gash' }),
    '3\t' + JSON.stringify({ t: 'ev', s: 'area', sc: 0, value: 300, src: other, dst: npc, name: 'Pil' }),
  ].join('\n');
  const r = anonymize(lines);
  assert.deepEqual(r.leaked, []);
  assert.ok(!r.out.includes('Ekte Navn') && !r.out.includes('Annen Spiller') && !r.out.includes('ekte.1234'));
  assert.ok(r.out.includes('Testkarakter') && r.out.includes('Spiller 1') && r.out.includes(':konto.0001'));
  assert.ok(r.out.includes('Wild Wavehawk') && r.out.includes('"value":-500') && r.out.startsWith('# GW2 Overlay'));
  // navnet står også i et felt skriptet ikke bytter (f.eks. et minion-navn): da skal det meldes, ikke skrives
  const leaky = anonymize(lines + '\n4\t' + JSON.stringify({ t: 'ev', s: 'area', sc: 0, src: { id: 9, name: "Ekte Navn's Pet", elite: NPC, self: 0 }, dst: npc }));
  assert.deepEqual(leaky.leaked, ['Ekte Navn']);
});
