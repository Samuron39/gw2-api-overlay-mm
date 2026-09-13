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
  // ArcDPS legger id og navn i src (src.prof != 0 betyr "lagt til"), og prof, elite, self og kontonavn i dst
  await send(
    { t: 'hello', arc: '20260901.1' },
    'dette er ikke json',
    { t: 'agent', src: { id: 100, name: 'Alfa', prof: 1, elite: 0 }, dst: { self: 1, name: 'Alfa.1234', prof: 1, elite: 62 } },
  );
  const s = await until((x) => x.connected && x.self, 'hello + agent');
  assert.equal(s.arcVersion, '20260901.1');
  assert.deepEqual(s.self, { id: 100, name: 'Alfa', prof: 1, elite: 62, account: 'Alfa.1234' });
  // andre spillere: også prof og elite fra dst
  await send({ t: 'agent', src: { id: 101, name: 'Beta', prof: 1, elite: 0 }, dst: { self: 0, name: 'Beta.5678', prof: 4, elite: 55 } });
  await until(() => live.agents.get(101)?.elite === 55, 'Beta registrert');
  assert.deepEqual(live.agents.get(101), { id: 101, name: 'Beta', prof: 4, elite: 55, self: 0 });
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

test('utløp sender ny tilstand til vinduene uten at noen annen hendelse kommer', async () => {
  const updates = [];
  const onUpdate = (s) => updates.push(s);
  live.on('update', onUpdate);
  await send(ev({ buff: 1, value: 300, skill: 725, name: 'Fury', dst: SELF, iff: 0 }));
  await until((x) => buff(x, 'Fury'), 'Fury påført');
  // den første oppdateringen har Fury, en senere oppdatering (uten nye hendelser) skal ikke ha den
  await new Promise((r) => setTimeout(r, 700));
  live.off('update', onUpdate);
  assert.ok(updates.some((s) => s.buffs.some((b) => b.name === 'Fury')), 'oppdatering med Fury');
  const last = updates[updates.length - 1];
  assert.ok(last && !last.buffs.some((b) => b.name === 'Fury'), 'siste oppdatering uten Fury');
});

test('target settes fra direkte skade og condition, sist truffet vinner, dødsstøt og kampslutt nullstiller', async () => {
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

  // dødsstøt (result 8) fra oss nullstiller målet med en gang
  await send(ev({ dst: GOLEM, iff: 1, value: -500, result: 8, skill: 100 }));
  s = await until((x) => x.target === null, 'dødsstøt nullstiller');
  // nytt mål fra chatbox-skade (negativt tall), og kampslutt nullstiller
  await send(ev({ dst: TRASH, iff: 1, value: -5, skill: 100 }));
  await until((x) => x.target?.id === 201, 'nytt mål fra negativ skade');
  await send(ev({ sc: 2 }));
  await until((x) => x.target === null && x.inCombat === false, 'sc 2 nullstiller target');
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

test('dedupe: samme arcdps-id i samme scope to ganger gir én stack, annet scope eller id 0 dedupliseres ikke', async () => {
  const swift = (over) => ev({ buff: 1, value: 5000, skill: 719, name: 'Swiftness', dst: SELF, iff: 0, ...over });
  const m = swift();
  await send(m, m);
  let s = await until((x) => buff(x, 'Swiftness'), 'Swiftness påført');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(buff(live.snapshot(), 'Swiftness').stacks, 1, 'dobbeltlevert hendelse telles én gang');
  // samme id fra det andre scopet er en annen hendelse
  await send({ ...m, s: 'area' });
  s = await until((x) => buff(x, 'Swiftness')?.stacks === 2, 'annet scope');
  // id 0 (eldre bro uten id) dedupliseres aldri
  await send(swift({ id: 0 }), swift({ id: 0 }));
  s = await until((x) => buff(x, 'Swiftness')?.stacks === 4, 'id 0');
  assert.equal(s.buffs.length, 1);
  await send(ev({ rem: 1, skill: 719, name: 'Swiftness', buff: 1 }));
  await until((x) => !buff(x, 'Swiftness'), 'ryddet');
});

test('sc 18 (buff initial): buffen legges på den som har den, max er varigheten, målet endres ikke', async () => {
  const targetBefore = live.snapshot().target?.id ?? null;
  await send(ev({ sc: 18, buff: 1, value: 20000, skill: 5492, name: 'Fire Attunement', src: SELF, dst: SELF, iff: 0 }));
  let s = await until((x) => buff(x, 'Fire Attunement'), 'attunement fra sc 18');
  let b = buff(s, 'Fire Attunement');
  assert.equal(b.stacks, 1);
  assert.equal(b.max, 20000);
  assert.ok(b.remainingMs > 19000 && b.remainingMs <= 20000, `gjenværende ~20 s, fikk ${b.remainingMs}`);
  // sc 18 på en fiende (fra oss) legges i målets liste, men flytter ikke målet
  await send(ev({ sc: 18, buff: 1, value: 9000, skill: 738, name: 'Vulnerability', src: SELF, dst: TRASH, iff: 1 }));
  await until(() => live.targets.get(TRASH.id)?.has(738), 'sc 18 på fiende');
  assert.equal(live.snapshot().target?.id ?? null, targetBefore, 'sc 18 endrer ikke målet');
  // ny påføring med annen varighet: én stack til, max følger siste påføring
  await send(ev({ buff: 1, value: 30000, skill: 5492, name: 'Fire Attunement', dst: SELF, iff: 0 }));
  s = await until((x) => buff(x, 'Fire Attunement')?.stacks === 2, 'to stacks');
  assert.equal(buff(s, 'Fire Attunement').max, 30000);
  // sc 18 uten varighet ignoreres
  await send(ev({ sc: 18, buff: 1, value: 0, skill: 5493, name: 'Water Attunement', src: SELF, dst: SELF, iff: 0 }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(buff(live.snapshot(), 'Water Attunement'), undefined);
  await send(ev({ rem: 1, skill: 5492, name: 'Fire Attunement', buff: 1 }));
  await until((x) => !buff(x, 'Fire Attunement'), 'ryddet');
});

test('forsinkelsen på evtc-kanalen måles mot klokkeavviket fra local', async () => {
  const t0 = Date.now();
  live.stats.areaLagMs = null; // tidligere tester kan ha målt noe
  await send(ev({ s: 'local', time: t0, sc: 1, src: SELF }));
  await until(() => Math.abs(live.offset) < 1500, 'offset fra local');
  await send(ev({ s: 'area', time: t0 - 2500, sc: 1, src: SELF }));
  const s = await until((x) => x.stats.areaLagMs != null, 'forsinkelse målt');
  assert.ok(s.stats.areaLagMs >= 2000 && s.stats.areaLagMs < 4000, 'målt ' + s.stats.areaLagMs);
});

test('opptak skriver datagrammene med ankomsttid til fil og stopper når tiden er ute', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const file = path.join(os.tmpdir(), 'gw2-overlay-test', 'live-rec-' + Date.now() + '.jsonl');
  live.record(file, 400);
  assert.ok(live.snapshot().recording?.file === file);
  await send({ t: 'hello', arc: 'rec' }, ev({ sc: 1 }));
  await until(() => live.stats.packets > 0 && fs.existsSync(file), 'fil skrevet');
  await until(() => !live.snapshot().recording, 'opptak stoppet av seg selv');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.ok(lines[0].startsWith('#'), 'header');
  assert.ok(lines.length >= 3, 'hello og hendelse skrevet');
  const [at, json] = lines[1].split('\t');
  assert.ok(Number(at) > 0 && JSON.parse(json).t === 'hello');
  fs.unlinkSync(file);
});

test('nye ArcDPS-koder på evtc-kanalen: 69 påfører, 70 endrer varighet, 71/72 fjerner, 67/68 er aktivering', async () => {
  const a = (over) => ev({ s: 'area', ...over });
  // 69 BUFFAPPLY: to stacks Might på deg
  await send(a({ sc: 69, buff: 1, value: 5000, skill: 740, name: 'Might', dst: SELF, iff: 0 }), a({ sc: 69, buff: 1, value: 5000, skill: 740, name: 'Might', dst: SELF, iff: 0 }));
  let s = await until((x) => buff(x, 'Might')?.stacks === 2, 'to stacks fra sc 69');
  // 70 BUFFCHANGE: aktiv stack forlenget til 20 s
  await send(a({ sc: 70, buff: 1, value: 15000, overstack: 20000, skill: 740, name: 'Might', dst: SELF }));
  s = await until((x) => buff(x, 'Might')?.remainingMs > 15000, 'forlenget fra sc 70');
  assert.equal(buff(s, 'Might').stacks, 2);
  // 71 BUFFREMOVE_SINGLE (rem 2), så 72 BUFFREMOVE_ALL (rem 1)
  await send(a({ sc: 71, buff: 1, rem: 2, skill: 740, name: 'Might', src: SELF }));
  s = await until((x) => buff(x, 'Might')?.stacks === 1, 'én stack fjernet via sc 71');
  await send(a({ sc: 72, buff: 1, rem: 1, skill: 740, name: 'Might', src: SELF }));
  await until((x) => !buff(x, 'Might'), 'alle fjernet via sc 72');
  // 67 ANIMATIONSTART (value = ms til treffpunkt) og 68 ANIMATIONSTOP (act 3 = utført)
  await send(a({ sc: 67, skill: 9100, name: 'Sverd', value: 600 }));
  s = await until((x) => cd(x, 9100), 'aktivering fra sc 67');
  assert.equal(cd(s, 9100).castDur, 600); assert.equal(cd(s, 9100).fired, false);
  await send(a({ sc: 68, skill: 9100, name: 'Sverd', act: 3, value: 600 }));
  s = await until((x) => cd(x, 9100)?.fired === true, 'utført fra sc 68');
  // 68 med act 4 = avbrutt: cooldown fjernes
  await send(a({ sc: 67, skill: 9101, name: 'Skjold', value: 400 }));
  await until((x) => cd(x, 9101), 'ny aktivering');
  await send(a({ sc: 68, skill: 9101, name: 'Skjold', act: 4, value: 100 }));
  await until((x) => !cd(x, 9101), 'avbrutt via sc 68 act 4');
});

test('DPS: egne treff og condition-ticks telles per kamp, blokkert teller ikke, mottatt telles, forrige kamp huskes', async () => {
  const t0 = Date.now();
  await send(ev({ sc: 2, time: t0 - 10 })); // avslutt en eventuell kamp fra tidligere tester
  await until((x) => !x.dps.current, 'ingen kamp i gang');
  await send(ev({ sc: 1, time: t0 }));
  await until((x) => x.inCombat && x.dps.current?.active, 'kamp startet');
  await send(
    ev({ time: t0 + 100, dst: GOLEM, iff: 1, value: -500, skill: 100, name: 'Slag', result: 1 }),
    ev({ time: t0 + 200, dst: GOLEM, iff: 1, value: -300, skill: 100, name: 'Slag', result: 0 }),
    ev({ time: t0 + 300, dst: GOLEM, iff: 1, buff: 1, buffDmg: 120, skill: 736, name: 'Bleeding', result: 14 }),
    ev({ time: t0 + 400, dst: GOLEM, iff: 1, value: -999, skill: 100, name: 'Slag', result: 3 }), // blokkert
    ev({ time: t0 + 500, src: GOLEM, dst: SELF, iff: 1, value: -250, skill: 555, name: 'Bitt' }), // mot oss
  );
  let s = await until((x) => x.dps.current?.total === 920, 'total 920');
  assert.equal(s.dps.current.taken, 250);
  assert.equal(s.dps.current.targets[0].name, 'Golem');
  assert.equal(s.dps.current.skills[0].name, 'Slag'); assert.equal(s.dps.current.skills[0].dmg, 800); assert.equal(s.dps.current.skills[0].hits, 2);
  assert.equal(s.dps.current.skills[1].name, 'Bleeding');
  assert.ok(s.dps.current.dps10 > 0);
  await send(ev({ sc: 2, time: t0 + 4000 }));
  s = await until((x) => !x.dps.current && x.dps.last, 'kamp avsluttet');
  assert.equal(s.dps.last.total, 920); assert.equal(s.dps.last.durationMs, 4000); assert.equal(s.dps.last.dps, 230);
  assert.equal(s.dps.last.target, 'Golem');
});

test('målbytte slik ArcDPS faktisk sender det: ev null, src.elite 1, dst null (README.txt)', async () => {
  await send({ t: 'agent', s: 'area', src: { id: 2114, name: '', prof: 0, elite: 1, self: 0, team: 0 }, dst: null, name: '' });
  await until((x) => x.target?.id === 2114, 'target satt fra elite 1');
});

test('klokkeavvik settes fra local-kanalen, ikke fra forsinkede area-hendelser', async () => {
  const t0 = Date.now() - 100000;
  await send(ev({ s: 'local', time: t0, sc: 1, src: SELF }));
  await until(() => Math.abs(live.offset - 100000) < 1500, 'offset fra local');
  const before = live.offset;
  await send(ev({ s: 'area', time: t0 - 3000, sc: 1, src: SELF }));
  await until((x) => x.inCombat, 'area-hendelsen mottatt');
  assert.equal(live.offset, before);
});

test('målbytte: agent-melding med src.elite 0xffffffff og dst null setter target, id 0 ignoreres', async () => {
  // ArcDPS sender dst = null og bare id i src; navnet kommer med første hendelse som treffer agenten
  await send({ t: 'agent', s: 'local', src: { id: 300, name: '', prof: 0, elite: 0xffffffff, self: 0, team: 0 }, dst: null, name: '' });
  let s = await until((x) => x.target?.id === 300, 'target fra målbytte');
  assert.equal(s.target.name, '');
  assert.deepEqual(s.target.buffs, []);
  await send(ev({ dst: { id: 300, name: 'Sjef', prof: 1, elite: 0xffffffff, self: 0, team: 2 }, iff: 1, value: 10, skill: 100 }));
  s = await until((x) => x.target?.name === 'Sjef', 'navn fra hendelse');
  // id 0 = ingen target valgt: ignoreres
  await send({ t: 'agent', s: 'local', src: { id: 0, name: '', prof: 0, elite: 0xffffffff, self: 0, team: 0 }, dst: null, name: '' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(live.snapshot().target?.id, 300);
  // eldre bro: dst.self = 1 i stedet for null. Skal ikke tolkes som registrering av deg selv.
  await send({ t: 'agent', s: 'local', src: { id: 200, name: 'Golem', prof: 0, elite: 0xffffffff, self: 0, team: 2 }, dst: { self: 1 }, name: '' });
  s = await until((x) => x.target?.id === 200, 'target fra eldre bro');
  assert.equal(s.self.id, 100, 'self er urørt');
  await send(ev({ sc: 2 }));
  await until((x) => x.target === null, 'sc 2 nullstiller');
});

// Heal-linje i broens format (protokollen øverst i bridge/src/lib.rs, bakgrunn i docs/healing-api.md)
function heal(over = {}) {
  return {
    t: 'heal', ch: 'local', id: ++seq, time: Date.now(),
    srcAgent: (over.src || SELF).id, dstAgent: (over.dst || SELF).id,
    skill: 0, name: '', value: 0, over: 0, barrier: 0, buff: 0, iff: 0, srcInst: 0, dstInst: 0, srcMaster: 0, dstMaster: 0, flags: 0, src: SELF, dst: SELF,
    ...over,
  };
}

test('healing: hello melder støtte, heal-linjer telles per kamp (gjort, per skill, mottatt, per kilde, HPS), ext bare for andre', async () => {
  const t0 = Date.now();
  await send({ t: 'hello', arc: '20260901.1', heal: 1, healExt: 1 });
  let s = await until((x) => x.dps.healing?.ext === true, 'healExt fra hello');
  assert.equal(s.dps.healing.available, true);
  assert.equal(s.dps.healing.supported, true);
  // utenfor kamp: ingenting telles og ingen kamp startes av healing alene
  await send(heal({ time: t0 - 10, value: 500, skill: 14413, name: 'Dolyak Signet' }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(live.snapshot().dps.current, null);
  await send(ev({ sc: 1, time: t0, srcInst: 5400 }));
  await until((x) => x.dps.current?.active, 'kamp startet');
  await send(
    heal({ time: t0 + 100, value: 490, skill: 14413, name: 'Dolyak Signet' }), // selv → selv
    heal({ time: t0 + 200, value: 737, skill: 76863, name: 'Chant of Recuperation', dst: OTHER }), // selv → annen
    heal({ time: t0 + 300, value: 1891, skill: 76782, name: 'Chant of Recuperation', dst: OTHER, barrier: 1 }), // barrier
    heal({ time: t0 + 400, value: 300, skill: 718, name: 'Regeneration', buff: 1, src: OTHER, dst: SELF }), // annen → selv
    heal({ time: t0 + 500, value: 200, skill: 9999, name: 'Minion Heal', src: { id: 555, name: 'Minion', prof: 0, elite: 0xffffffff, self: 0, team: 1 }, srcMaster: 5400, dst: SELF }), // vår minion → selv
    heal({ time: t0 + 600, value: 5000, skill: 1, name: 'Ikke oss', src: OTHER, dst: { ...GOLEM } }), // andre → andre: ignoreres
  );
  s = await until((x) => x.dps.current?.healing.done === 3318, 'healing gjort 490+737+1891+200');
  const h = s.dps.current.healing;
  assert.equal(h.barrier, 1891);
  assert.equal(h.received, 990, 'mottatt: 490 + 300 + 200');
  assert.equal(h.bySkill.length, 4);
  assert.equal(h.bySkill[0].name, 'Chant of Recuperation'); assert.equal(h.bySkill[0].heal, 1891); assert.equal(h.bySkill[0].pct, 57);
  assert.equal(h.bySource.length, 3);
  assert.equal(h.bySource[0].name, 'Alfa'); assert.equal(h.bySource[0].heal, 490);
  assert.ok(h.hps10 > 0 && h.hps > 0, 'HPS nå og snitt');
  assert.equal(h.available, true);
  assert.equal(s.dps.current.total, 0, 'healing er ikke skade');
  // ext-kanalen (healing stats-utvidelsen): egne hendelser er duplikater og ignoreres, andres går i squad-lista
  await send(
    { ...heal({ time: t0 + 700, value: 999, skill: 14413, name: 'Dolyak Signet' }), ch: 'ext' },
    { ...heal({ time: t0 + 800, value: 1200, skill: 5, name: 'Healing Spring', src: OTHER, dst: OTHER }), ch: 'ext' },
  );
  s = await until((x) => x.dps.current?.healing.squad.length === 1, 'squad fra ext');
  assert.equal(s.dps.current.healing.done, 3318, 'egen ext-hendelse ikke telt dobbelt');
  assert.deepEqual(s.dps.current.healing.squad[0], { id: 101, name: 'Beta', heal: 1200 });
  // eldre bro uten heal-linjer: positiv value i chatbox-kanalen med iff 0 er healing, ikke mottatt skade
  await send(ev({ time: t0 + 900, src: OTHER, dst: SELF, iff: 0, value: 400, skill: 7, name: 'Gammel heal', result: 0 }));
  s = await until((x) => x.dps.current?.healing.received === 1390, 'eldre format telt som mottatt');
  assert.equal(s.dps.current.taken, 0, 'ikke telt som mottatt skade');
  // kampslutt: forrige kamp har healing med, HPS = totalt / varighet
  await send(ev({ sc: 2, time: t0 + 4000 }));
  s = await until((x) => !x.dps.current && x.dps.last, 'kamp avsluttet');
  assert.equal(s.dps.last.healing.done, 3318);
  assert.equal(s.dps.last.healing.hps, Math.round(3318 / 4));
  assert.equal(s.dps.last.healing.received, 1390);
  assert.equal(s.dps.last.healing.hps10, 0, 'HPS nå bare for pågående kamp');
});

test('healing: eldre bro uten heal i hello gir available false til noe er telt, dedupe per kanal', async () => {
  await send({ t: 'hello', arc: '20260901.1' });
  await until((x) => x.dps.healing.supported === false, 'støtte av');
  live.healSeen = false;
  assert.equal(live.snapshot().dps.healing.available, false);
  const t0 = Date.now();
  await send(ev({ sc: 1, time: t0, srcInst: 5400 }));
  await until((x) => x.dps.current?.active, 'kamp startet');
  const m = heal({ time: t0 + 100, value: 300, skill: 14413, name: 'Dolyak Signet' });
  await send(m, m, { ...m, ch: 'ext' }); // samme id to ganger på local = én, ext-kopien av egen heal ignoreres
  const s = await until((x) => x.dps.current?.healing.done === 300, 'én gang telt');
  assert.equal(s.dps.healing.available, true, 'telt healing gjør seksjonen tilgjengelig');
  await send(ev({ sc: 2, time: t0 + 2000 }));
  await until((x) => !x.dps.current, 'kamp avsluttet');
});
