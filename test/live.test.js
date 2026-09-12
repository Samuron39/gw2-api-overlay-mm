'use strict';
// Tester for live-tilstanden i src/live.js: JSON-linjer over UDP fra ArcDPS-broen, verifisert via snapshot().
// Bruker en egen testport så en kjørende overlay (47500) ikke forstyrres.
const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const live = require('../src/live');

const PORT = 47599;
const SELF = { id: 100, name: 'Alfa', prof: 1, elite: 62, self: 1, team: 1 };
const OTHER = { id: 101, name: 'Beta', prof: 4, elite: 55, self: 0, team: 1 };
const GOLEM = { id: 200, name: 'Golem', prof: 0x1234, elite: 0xffffffff, self: 0, team: 2 };
const TRASH = { id: 201, name: 'Trash', prof: 0x0777, elite: 0xffffffff, self: 0, team: 2 };

let client;
let seq = 0;

// Hendelse i broens format; src er deg selv med mindre annet er gitt
function ev(over = {}) {
  return {
    t: 'ev', s: 'local', id: ++seq, time: Date.now(),
    srcAgent: (over.src || SELF).id, dstAgent: over.dst ? over.dst.id : 0,
    skill: 0, name: '', value: 0, buffDmg: 0, overstack: 0, iff: 2, buff: 0, result: 0, act: 0, rem: 0, sc: 0,
    srcInst: 0, dstInst: 0, srcMaster: 0, dstMaster: 0, src: SELF, dst: null,
    ...over,
  };
}

function send(...msgs) {
  const payload = msgs.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n') + '\n';
  return new Promise((res, rej) => client.send(payload, PORT, '127.0.0.1', (e) => (e ? rej(e) : res())));
}

// Venter til snapshot() oppfyller betingelsen (UDP leveres asynkront)
async function until(pred, what) {
  const t0 = Date.now();
  for (;;) {
    const s = live.snapshot();
    if (pred(s)) return s;
    if (Date.now() - t0 > 2000) assert.fail('Tidsavbrudd: ' + what);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const buff = (s, name) => s.buffs.find((b) => b.name === name);
const cd = (s, skill) => s.cooldowns.find((c) => c.skill === skill);

test.before(async () => {
  live.start(PORT);
  await new Promise((r) => live.socket.once('listening', r));
  client = dgram.createSocket('udp4');
});

test.after(() => {
  client.close();
  live.stop();
  assert.equal(live.socket, null, 'stop() lukker socketen');
  assert.equal(live.timer, null);
});

test('før hello: ikke tilkoblet, ingen self', () => {
  const s = live.snapshot();
  assert.equal(s.connected, false);
  assert.equal(s.self, null);
  assert.equal(s.weaponSet, 'A');
});

test('hello og agent-registrering av self i samme datagram, ugyldig linje ignoreres', async () => {
  await send(
    { t: 'hello', arc: '20260901.1' },
    'dette er ikke json',
    { t: 'agent', src: { id: 100, name: 'Alfa', prof: 1, elite: 62 }, dst: { self: 1, name: 'Alfa.1234' } },
  );
  const s = await until((x) => x.connected && x.self, 'hello + agent');
  assert.equal(s.arcVersion, '20260901.1');
  assert.deepEqual(s.self, { id: 100, name: 'Alfa', prof: 1, elite: 62, account: 'Alfa.1234' });
});

test('statechange 1 og 2: inn og ut av kamp', async () => {
  await send(ev({ sc: 1 }));
  await until((x) => x.inCombat === true, 'inn i kamp');
  await send(ev({ sc: 2 }));
  await until((x) => x.inCombat === false, 'ut av kamp');
  // statechange fra en annen agent påvirker ikke oss
  await send(ev({ sc: 1, src: OTHER }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(live.snapshot().inCombat, false);
});

test('buff på deg: påføring gir stacks og gjenværende tid, fjerning av én og alle stacks', async () => {
  const might = (over) => ev({ buff: 1, value: 5000, skill: 740, name: 'Might', dst: SELF, iff: 0, ...over });
  await send(might(), might());
  let s = await until((x) => buff(x, 'Might')?.stacks === 2, 'to stacks Might');
  const m = buff(s, 'Might');
  assert.ok(m.remainingMs > 4000 && m.remainingMs <= 5100, `gjenværende ~5 s, fikk ${m.remainingMs}`);
  assert.equal(m.skill, 740);
  assert.equal(m.src, 'Alfa');

  await send(ev({ rem: 2, skill: 740, name: 'Might', buff: 1 }));
  s = await until((x) => buff(x, 'Might')?.stacks === 1, 'én stack fjernet');

  await send(ev({ rem: 1, skill: 740, name: 'Might', buff: 1 }));
  s = await until((x) => !buff(x, 'Might'), 'alle stacks fjernet');
  assert.equal(s.buffs.length, 0);
});

test('buff med kort varighet forsvinner av seg selv når tiden er ute', async () => {
  await send(ev({ buff: 1, value: 60, skill: 725, name: 'Fury', dst: SELF, iff: 0 }));
  await until((x) => buff(x, 'Fury'), 'Fury påført');
  await until((x) => !buff(x, 'Fury'), 'Fury utløpt');
});

test('target settes fra direkte skade og condition, sist truffet vinner, sc 2 nullstiller', async () => {
  await send(ev({ dst: GOLEM, iff: 1, value: 1200, skill: 100, name: 'Slag' }));
  let s = await until((x) => x.target?.id === 200, 'target fra skade');
  assert.equal(s.target.name, 'Golem');
  assert.deepEqual(s.target.buffs, []);

  await send(ev({ dst: GOLEM, iff: 1, buff: 1, value: 3000, skill: 736, name: 'Bleeding' }));
  s = await until((x) => x.target?.buffs.some((b) => b.name === 'Bleeding'), 'condition på target');
  assert.equal(s.target.buffs[0].stacks, 1);

  // condition på en annen fiende flytter målet dit
  await send(ev({ dst: TRASH, iff: 1, buff: 1, value: 3000, skill: 737, name: 'Burning' }));
  s = await until((x) => x.target?.id === 201, 'target fra condition');
  assert.equal(s.target.buffs[0].name, 'Burning');

  // skade på golemen igjen: tilbake, med Bleeding fortsatt der
  await send(ev({ dst: GOLEM, iff: 1, buffDmg: 300, buff: 1, skill: 736, name: 'Bleeding' }));
  s = await until((x) => x.target?.id === 200, 'target tilbake fra condition-skade');
  assert.equal(s.target.buffs[0].name, 'Bleeding');

  // skade fra andre flytter ikke vårt mål
  await send(ev({ src: OTHER, dst: TRASH, iff: 1, value: 999, skill: 100 }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(live.snapshot().target.id, 200);

  await send(ev({ sc: 2 }));
  s = await until((x) => x.target === null, 'sc 2 nullstiller target');
});

test('aktivering gir cooldown, fullført aktivering setter fired, avbrudd fjerner', async () => {
  await send(ev({ act: 1, skill: 9000, name: 'Foo', value: 800 }));
  let s = await until((x) => cd(x, 9000), 'aktivering registrert');
  let c = cd(s, 9000);
  assert.equal(c.name, 'Foo');
  assert.equal(c.castDur, 800);
  assert.equal(c.fired, false);
  assert.ok(c.castStart > 0);
  // før fired regnes sinceMs fra forventet slutt på castet, altså negativt mens castet pågår
  assert.ok(c.sinceMs <= 0 && c.sinceMs >= -800, `sinceMs under cast, fikk ${c.sinceMs}`);

  await send(ev({ act: 3, skill: 9000, name: 'Foo' }));
  s = await until((x) => cd(x, 9000)?.fired === true, 'fired');
  c = cd(s, 9000);
  assert.ok(c.sinceMs >= 0 && c.sinceMs < 2000, `sinceMs siden fired, fikk ${c.sinceMs}`);

  await send(ev({ act: 4, skill: 9000, name: 'Foo' }));
  await until((x) => !cd(x, 9000), 'avbrudd fjerner');

  // reset/instant (act 5) uten forutgående start registreres som fired
  await send(ev({ act: 5, skill: 9001, name: 'Bar' }));
  s = await until((x) => cd(x, 9001), 'act 5');
  assert.equal(cd(s, 9001).fired, true);

  // andres aktiveringer ignoreres
  await send(ev({ src: OTHER, act: 1, skill: 9002, name: 'Baz', value: 500 }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(cd(live.snapshot(), 9002), undefined);
});

test('våpenbytte: statechange 11 med dstAgent 5 gir sett B, 4 gir A, 0/1 gir vann-sett', async () => {
  await send(ev({ sc: 11, dstAgent: 5 }));
  await until((x) => x.weaponSet === 'B', 'sett B');
  await send(ev({ sc: 11, dstAgent: 1 }));
  await until((x) => x.weaponSet === 'W2', 'sett W2');
  await send(ev({ sc: 11, dstAgent: 0 }));
  await until((x) => x.weaponSet === 'W1', 'sett W1');
  await send(ev({ sc: 11, dstAgent: 4 }));
  await until((x) => x.weaponSet === 'A', 'sett A');
  // ukjent verdi beholder gjeldende sett, og andres bytte ignoreres
  await send(ev({ sc: 11, dstAgent: 5 }), ev({ sc: 11, dstAgent: 7 }));
  await until((x) => x.weaponSet === 'B', 'sett B igjen');
  await send(ev({ sc: 11, dstAgent: 4, src: OTHER }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(live.snapshot().weaponSet, 'B');
});
