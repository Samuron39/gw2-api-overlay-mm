'use strict';
// Tester for tidsplan-dataene: data/event-timer-wiki.json via src/modules/timers.js getData() og data/waypoints.json.
// Selve tidsplan-logikken ligger i en IIFE i renderer, så her ekspanderes sekvensene på samme måte som der
// (partial først, deretter pattern gjentatt til døgnet er fylt).
const test = require('node:test');
const assert = require('node:assert/strict');
const { getData } = require('../src/modules/timers');

const data = getData();

// Dekoder en chat-lenke [&B...=]: byte 0 er typen (4 = waypoint), id er 3 byte little-endian
function decodeChatlink(link) {
  const m = /^\[&([A-Za-z0-9+/=]+)\]$/.exec(String(link).trim()); // enkelte oppføringer i wikidataene har mellomrom rundt
  assert.ok(m, `ugyldig chatlink ${link}`);
  const b = Buffer.from(m[1], 'base64');
  return { type: b[0], id: b[1] | (b[2] << 8) | (b[3] << 16) };
}

// Samme ekspansjon som renderer/modules/timers.js
function expand(e) {
  const segs = [];
  let t = 0;
  for (const s of e.sequences?.partial || []) { segs.push({ r: s.r, start: t, end: t + s.d }); t += s.d; }
  const pat = e.sequences?.pattern || [];
  let guard = 0;
  while (pat.length && t < 1440 && guard++ < 3000) {
    for (const s of pat) { segs.push({ r: s.r, start: t, end: t + s.d }); t += s.d; if (t >= 1440) break; }
  }
  return { segs, total: t };
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

test('waypoints.json dekker alle chatlinks i core-wb', () => {
  const wb = data.events['core-wb'];
  for (const s of Object.values(wb.segments)) {
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
