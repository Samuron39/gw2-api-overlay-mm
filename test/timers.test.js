'use strict';
// Tester for tidsplan-dataene: data/event-timer-wiki.json via src/modules/timers.js getData() og data/waypoints.json.
// Samme rene implementasjon som renderer, ingen kopi av tidsberegningen i testen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { getData, expand: timeline, status, bossSpawns } = require('../src/modules/timers');

const data = getData();

// Dekoder en chat-lenke [&B...=]: byte 0 er typen (4 = waypoint), id er 3 byte little-endian
function decodeChatlink(link) {
  const m = /^\[&([A-Za-z0-9+/=]+)\]$/.exec(String(link).trim()); // enkelte oppføringer i wikidataene har mellomrom rundt
  assert.ok(m, `ugyldig chatlink ${link}`);
  const b = Buffer.from(m[1], 'base64');
  return { type: b[0], id: b[1] | (b[2] << 8) | (b[3] << 16) };
}

function expand(e) {
  const segs = timeline(e);
  return { segs, total: segs.at(-1)?.end || 0 };
}

test('getData: versjon, ingen tom-oppføring og samme objekt ved gjentatte kall', () => {
  assert.match(String(data.version), /^v\d/);
  assert.ok(!('t' in data.events), 'nøkkelen t er et tidsstempel, ikke en tidsplan');
  for (const [k, e] of Object.entries(data.events)) assert.ok(e.name, `tidsplan ${k} mangler navn`);
  assert.ok(Object.keys(data.events).length >= 40);
  assert.equal(getData(), data, 'caches');
});

test('world bosses (core-wb): 10 segmenter, alle med navn og chatlink', () => {
  const wb = data.events['core-wb'];
  assert.ok(wb, 'core-wb finnes');
  assert.equal(wb.name, 'World bosses');
  const segs = Object.values(wb.segments);
  assert.equal(segs.length, 10);
  const navn = new Set();
  for (const s of segs) {
    assert.ok(s.name, 'segment mangler navn');
    assert.match(s.chatlink, /^\[&[A-Za-z0-9+/=]+\]$/, s.name);
    navn.add(s.name);
  }
  assert.equal(navn.size, 10, 'unike navn');
  for (const boss of ['The Shatterer', 'Golem Mark II', 'Claw of Jormag', 'Shadow Behemoth']) assert.ok(navn.has(boss), boss);
});

test('core-wb: pattern gjentatt fyller minst 1440 minutter og peker bare på kjente segmenter', () => {
  const wb = data.events['core-wb'];
  const { segs, total } = expand(wb);
  assert.ok(total >= 1440, `total ${total}`);
  for (const s of segs) assert.ok(wb.segments[s.r], `ukjent segment ${s.r}`);
  // sammenhengende uten hull
  for (let i = 1; i < segs.length; i++) assert.equal(segs[i].start, segs[i - 1].end);
  // hver boss dukker opp minst én gang i døgnet
  const brukt = new Set(segs.map((s) => String(s.r)));
  for (const r of Object.keys(wb.segments)) assert.ok(brukt.has(r), `segment ${r} (${wb.segments[r].name}) er aldri i sekvensen`);
});

test('alle tidsplaner: sekvensene dekker døgnet og segmentreferansene finnes', () => {
  for (const [k, e] of Object.entries(data.events)) {
    const { segs, total } = expand(e);
    assert.ok(total >= 1440, `${k}: ${total} min`);
    for (const s of segs) {
      assert.ok(e.segments?.[s.r], `${k}: ukjent segment ${s.r}`);
      assert.ok(s.end > s.start, `${k}: segment uten varighet`);
    }
  }
});

test('waypoints.json dekker alle chatlinks i alle tidsplaner', () => {
  for (const event of Object.values(data.events)) for (const s of Object.values(event.segments)) {
    if (!s.chatlink) continue;
    const { type, id } = decodeChatlink(s.chatlink);
    assert.equal(type, 4, `${s.name}: chatlink er ikke et waypoint`);
    const wp = data.waypoints[id];
    assert.ok(wp, `${s.name}: waypoint ${id} mangler i waypoints.json`);
    assert.match(wp.name, /Waypoint$/);
    assert.equal(typeof wp.mapId, 'number');
    assert.ok(wp.map);
    assert.ok(Array.isArray(wp.coord) && wp.coord.length === 2);
  }
});

test('Taidha bruker halvåpent aktivt intervall og blir neste spawn ved slutt', () => {
  const at = (minute) => Date.UTC(2026, 8, 17) + minute * 60000;
  for (const minute of [0, 1, 14.999]) {
    const boss = bossSpawns(data.events, at(minute)).get('admiral_taidha_covington');
    assert.equal(boss.active, true); assert.equal(boss.inMin, 0);
    assert.equal(status(data.events['core-wb'], at(minute)).cur.name, boss.name);
  }
  const boss = bossSpawns(data.events, at(15)).get('admiral_taidha_covington');
  assert.equal(boss.active, false); assert.equal(boss.inMin, 165);
});

test('Alle restsegmenter fortsetter uten hopp ved UTC-midnatt', () => {
  for (const [key, event] of Object.entries(data.events)) {
    const last = timeline(event).at(-1);
    if (last.end <= 1440) continue;
    const before = status(event, Date.UTC(2026, 8, 17, 23, 59, 59));
    const after = status(event, Date.UTC(2026, 8, 18));
    assert.equal(before.curId, after.curId, key);
    assert.ok(Math.abs(before.remaining - after.remaining - 1) < 0.001, key);
    assert.ok(after.progress >= before.progress, key);
  }
  const ds = status(data.events['hot-ds'], Date.UTC(2026, 8, 18, 0, 1));
  assert.equal(ds.curFiller, false);
  assert.equal(ds.remaining, 89 * 60);
  assert.ok(Math.abs(ds.progress - 31 / 120) < 0.00001);
});

test('Drakkar kobles til API-id selv om segmentet også nevner Spirits of the Wild', () => {
  const boss = bossSpawns(data.events, Date.UTC(2026, 8, 17, 1, 10)).get('drakkar');
  assert.ok(boss); assert.equal(boss.active, true); assert.ok(boss.chatlink);
});

test('alle chatlinks i datasettet er waypoint-lenker (type 4)', () => {
  let n = 0;
  for (const [k, e] of Object.entries(data.events)) {
    for (const s of Object.values(e.segments || {})) {
      if (!s.chatlink) continue;
      n++;
      assert.equal(decodeChatlink(s.chatlink).type, 4, `${k}: ${s.name}`);
    }
  }
  assert.ok(n > 50, `fant bare ${n} chatlinks`);
});
