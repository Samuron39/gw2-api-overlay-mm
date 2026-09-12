'use strict';
// Test for mottakeren i src/live.js: broen batcher flere JSON-linjer per UDP-datagram (adskilt med \n).
// Sender én batch til port 47500 (eller LIVE_TEST_PORT) og sjekker at alle hendelsene tolkes,
// at tellerne i snapshot stemmer, og at tap oppdages ved hopp i løpenummeret "n".
// Kjør: npm test   (eller: node --test test/live-batch.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');
const live = require('../src/live');

const PORT = Number(process.env.LIVE_TEST_PORT) || 47500;
let port = PORT; // faktisk port: 47500, eller en ledig port hvis appen kjører og holder 47500
const NPC = 0xffffffff;
const T0 = 5_000_000; // arcdps-tid (ms) for første hendelse

const ME = { id: 2000, name: 'Testkarakter', prof: 4, elite: 0, self: 1, team: 1 };
const BOSS = { id: 3000, name: 'Testboss', prof: 100, elite: NPC, self: 0, team: 2 };
const OTHER = { id: 2001, name: 'Annen spiller', prof: 1, elite: 0, self: 0, team: 1 };

let seq = 0;
// Samme hendelsesformat som broen sender og src/live.js leser
function ev(o) {
  return {
    t: 'ev', s: 'local', n: ++seq, id: 100 + seq, time: T0,
    srcAgent: o.src ? o.src.id : 0, dstAgent: o.dst ? o.dst.id : 0, skill: 0, name: '', value: 0, buffDmg: 0, overstack: 0,
    iff: 0, buff: 0, result: 0, act: 0, rem: 0, sc: 0, srcInst: 1, dstInst: 2, srcMaster: 0, dstMaster: 0, src: null, dst: null,
    ...o,
  };
}

function send(lines) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const buf = Buffer.from(lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n', 'utf8');
    sock.send(buf, port, '127.0.0.1', (err) => { sock.close(); err ? reject(err) : resolve(buf.length); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Starter mottakeren og venter til porten er bundet. false hvis porten er opptatt.
function startLive(p) {
  return new Promise((resolve) => {
    live.start(p);
    live.socket.once('listening', () => resolve(true));
    live.socket.once('error', () => { live.stop(); resolve(false); });
  });
}

test('batch med flere linjer per datagram tolkes fullt ut', async () => {
  if (!(await startLive(port))) {
    port = 47600 + Math.floor(Math.random() * 400);
    assert.ok(await startLive(port), `fikk ikke bundet port ${PORT} eller ${port}`);
    console.log(`# port ${PORT} er opptatt (appen kjører?), tester på ${port}`);
  }
  try {
    const batch = [
      { t: 'hello', v: 1, arc: 'test-arc' },
      { t: 'agent', s: 'local', n: ++seq, id: 1, src: ME, dst: { ...ME, name: 'Konto.1234' }, name: '' }, // registrering av deg
      ev({ sc: 1, src: ME, dst: null }), // inn i kamp
      ev({ buff: 1, value: 10000, skill: 740, name: 'Might', src: OTHER, dst: ME }),
      ev({ buff: 1, value: 12000, skill: 740, name: 'Might', src: OTHER, dst: ME }), // stack 2
      ev({ buff: 1, value: 8000, skill: 1187, name: 'Quickness', src: ME, dst: ME }),
      ev({ s: 'area', buff: 1, value: 6000, skill: 736, name: 'Bleeding', iff: 1, src: ME, dst: BOSS }), // condition på målet
      ev({ act: 1, value: 750, skill: 9999, name: 'Testskill', src: ME, dst: null }), // aktivering
      ev({ sc: 11, dstAgent: 5, src: ME, dst: null }), // våpensett B
    ];
    const bytes = await send(batch);
    assert.ok(bytes > 1000, 'batchen skal være en realistisk størrelse (>1000 byte)');
    await sleep(150);

    const s = live.snapshot();
    assert.equal(s.connected, true);
    assert.equal(s.arcVersion, 'test-arc');
    assert.equal(s.self?.name, 'Testkarakter');
    assert.equal(s.inCombat, true);
    assert.equal(s.weaponSet, 'B');
    const might = s.buffs.find((b) => b.skill === 740);
    assert.ok(might, 'Might skal finnes');
    assert.equal(might.stacks, 2);
    assert.ok(might.remainingMs > 11000 && might.remainingMs <= 12000, `remainingMs: ${might.remainingMs}`);
    assert.ok(s.buffs.find((b) => b.skill === 1187), 'Quickness skal finnes');
    assert.equal(s.target?.name, 'Testboss');
    assert.ok(s.target.buffs.find((b) => b.skill === 736), 'Bleeding på målet');
    assert.ok(s.cooldowns.find((c) => c.skill === 9999), 'aktivering registrert');
    assert.deepEqual(s.stats, { packets: 1, events: batch.length - 1, dropsDetected: 0 }); // hello telles ikke som hendelse

    // Fjerning: én stack av Might, så alle stacks (rem === 1) av Quickness
    await send([
      ev({ rem: 2, skill: 740, name: 'Might', src: ME, dst: OTHER }),
      ev({ rem: 1, skill: 1187, name: 'Quickness', src: ME, dst: null }),
    ]);
    await sleep(100);
    const s2 = live.snapshot();
    assert.equal(s2.buffs.find((b) => b.skill === 740)?.stacks, 1);
    assert.equal(s2.buffs.find((b) => b.skill === 1187), undefined, 'rem === 1 nullstiller');
    assert.equal(s2.stats.packets, 2);

    // Tap: hopp over 3 løpenummer
    seq += 3;
    await send([ev({ buff: 1, value: 5000, skill: 725, name: 'Fury', src: ME, dst: ME })]);
    await sleep(100);
    const s3 = live.snapshot();
    assert.equal(s3.stats.dropsDetected, 3);
    assert.equal(s3.stats.packets, 3);
    assert.ok(s3.buffs.find((b) => b.skill === 725));

    // Ufullstendig linje i en batch skal ikke stoppe resten
    await send(['{"t":"ev","s":"local"', ev({ buff: 1, value: 5000, skill: 743, name: 'Aegis', src: ME, dst: ME })]);
    await sleep(100);
    assert.ok(live.snapshot().buffs.find((b) => b.skill === 743), 'linja etter en ødelagt linje tolkes');
  } finally {
    live.stop();
  }
});

test('buffs uten hendelser på 5 minutter fjernes', () => {
  live.buffs.clear();
  live.offset = 0;
  const now = live.now();
  live.buffs.set(1, { name: 'Gammel', expiries: [now + 60e3], src: '', seen: now - 6 * 60e3 });
  live.buffs.set(2, { name: 'Fersk', expiries: [now + 60e3], src: '', seen: now - 10e3 });
  const list = live.buffList(live.buffs);
  assert.deepEqual(list.map((b) => b.name), ['Fersk']);
  assert.equal(live.buffs.size, 1);
});
