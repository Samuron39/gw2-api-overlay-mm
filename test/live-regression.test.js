'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const live = require('../src/live');
const SELF = { id: 1, name: 'Alfa', self: 1, prof: 1, elite: 0 };
const OTHER = { id: 2, name: 'Beta', self: 0, prof: 2, elite: 0 };
const TARGET = { id: 3, name: 'Golem', self: 0, prof: 15438, elite: 0xffffffff };
const heal = (id, time, src = OTHER) => ({ t: 'heal', ch: 'ext', id, time, value: 1200, src, dst: SELF, skill: 1 });
test.beforeEach(() => live.reset());
test.afterEach(() => live.stop());

test('forsinket ekstern healing beholdes i riktig kamp, også etter folding og duplikat', () => {
  live.startFight(1000); live.endFight(2000);
  live.handle(heal(1, 1500));
  assert.equal(live.lastRaw.squadHeal.get(OTHER.id)?.heal, 1200);
  assert.equal(live.sessionSnapshot(2500).healing.squad[0]?.heal, 1200);
  live.startFight(3000);
  live.handle(heal(2, 1700));
  assert.equal(live.fight.squadHeal.size, 0);
  live.endFight(4000); // kamp 1 er nå foldet inn i økta
  live.handle(heal(3, 1800)); live.handle(heal(3, 1800));
  assert.equal(live.sessionSnapshot(4500).healing.squad[0]?.heal, 3600);
  live.handle(heal(4, 1800, SELF)); // egen ext-kopi skal fortsatt ignoreres
  assert.equal(live.sessionSnapshot(4500).healing.squad[0]?.heal, 3600);
  live.resetSession(); live.handle(heal(5, 1800));
  assert.equal(live.sessionSnapshot(4500).healing.squad.length, 0, 'gammel kamp gjenoppliver ikke nullstilt økt');
});

test('utløp oppdaterer egne og målets stacks uten nye kampmeldinger', async () => {
  live.start(0); // OS velger egen testport; aldri appens port
  await new Promise(resolve => live.socket.once('listening', resolve));
  const now = Date.now(); live.offset = 0; live.touchTarget(TARGET.id); live.agents.set(TARGET.id, TARGET); // touchTarget: et mål uten livstegn slippes av expireTarget
  live.buffs.set(740, { name: 'Might', expiries: [now + 150, now + 5000], dur: 5000 });
  live.targets.set(TARGET.id, new Map([[738, { name: 'Vulnerability', expiries: [now + 150, now + 5000], dur: 5000 }]]));
  const first = live.snapshot();
  assert.equal(first.buffs[0].stacks, 2);
  assert.equal(first.buffs[0].remainingMs > 4000, true, 'visningen beholder lengste varighet');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { live.off('update', onUpdate); reject(new Error('Stack-utløp ga ingen oppdatering')); }, 1000);
    function onUpdate(s) {
      if (s.buffs[0]?.stacks === 1 && s.target?.buffs[0]?.stacks === 1) { clearTimeout(timer); live.off('update', onUpdate); resolve(); }
    }
    live.on('update', onUpdate);
  });
});
