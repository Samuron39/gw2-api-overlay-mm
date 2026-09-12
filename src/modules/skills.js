'use strict';
// Skill-bar: hvilke skills karakteren du spiller har nå (våpen, heal/utility/elite og profesjonsmekanikk F1–F5),
// med ikoner, cooldown og hvilke boons de gir, fra API-et. Alle lagrede builds hentes, rotasjon lagres per build.
const fs = require('fs');
const path = require('path');
const gw2 = require('../gw2');
const ai = require('../ai');

const PROF_NAMES = { 1: 'Guardian', 2: 'Warrior', 3: 'Engineer', 4: 'Ranger', 5: 'Thief', 6: 'Elementalist', 7: 'Mesmer', 8: 'Necromancer', 9: 'Revenant' };
const BOON_NAMES = ['Might', 'Fury', 'Quickness', 'Alacrity', 'Protection', 'Regeneration', 'Swiftness', 'Vigor', 'Stability', 'Aegis', 'Resolution', 'Resistance'];
let index = null;
const profCache = new Map();
const specCache = new Map();
const lastBar = new Map(); // key -> skillbar

function cacheFile() { try { return path.join(require('electron').app.getPath('userData'), 'skills-index-v2.json'); } catch { return null; } }

function slim(s) {
  const facts = s.facts || [];
  const recharge = facts.find((f) => f.type === 'Recharge')?.value || 0;
  const buffs = [...new Set(facts.filter((f) => f.type === 'Buff' && f.status).map((f) => f.status))];
  return { id: s.id, name: s.name, icon: s.icon, slot: s.slot || '', type: s.type || '', weapon_type: s.weapon_type || '', professions: s.professions || [], specialization: s.specialization || 0, recharge, buffs, description: (s.description || '').replace(/<[^>]+>/g, '').slice(0, 220), attunement: s.attunement || '', dual_wield: s.dual_wield || '', flags: s.flags || [], chat_link: s.chat_link };
}

async function fetchIndex() {
  if (index) return index;
  const file = cacheFile();
  try { const raw = JSON.parse(fs.readFileSync(file, 'utf8')); if (Date.now() - raw.fetchedAt < 14 * 864e5) { index = raw; return raw; } } catch { /* ingen cache */ }
  const first = await gw2.get('/skills', { params: { page: 0, page_size: 200 }, withHeaders: true });
  const total = Number(first.headers['x-page-total'] || 1);
  const pages = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 1);
  const rest = await gw2.mapLimit(pages, 4, (p) => gw2.get('/skills', { params: { page: p, page_size: 200 }, bulk: true }));
  const byId = {};
  for (const arr of [first.body, ...rest]) for (const s of arr) byId[s.id] = slim(s);
  index = { fetchedAt: Date.now(), byId };
  if (file) { try { fs.writeFileSync(file, JSON.stringify(index)); } catch { /* ikke kritisk */ } }
  return index;
}

async function profession(name) {
  if (profCache.has(name)) return profCache.get(name);
  const p = await gw2.get(`/professions/${name}`, { params: { v: '2019-12-19T00:00:00.000Z' } });
  profCache.set(name, p);
  return p;
}
async function specialization(id) {
  if (!id) return null;
  if (specCache.has(id)) return specCache.get(id);
  try { const s = await gw2.get(`/specializations/${id}`); specCache.set(id, s); return s; } catch { return null; }
}

function weaponSkillsFor(prof, weaponType, hand, specId, idx, attunement) {
  const w = prof.weapons?.[weaponType];
  if (!w) return [];
  const list = (w.skills || []).filter((s) => {
    const sk = idx.byId[s.id];
    if (sk?.specialization && sk.specialization !== specId) return false;
    if (s.attunement && s.attunement !== attunement) return false;
    if (hand === 'main' && !['Weapon_1', 'Weapon_2', 'Weapon_3'].includes(s.slot)) return false;
    if (hand === 'off' && !['Weapon_4', 'Weapon_5'].includes(s.slot)) return false;
    if (s.offhand && hand === 'main') return false;
    return true;
  });
  const bySlot = new Map();
  for (const s of list) if (!bySlot.has(s.slot)) bySlot.set(s.slot, idx.byId[s.id] || { id: s.id, name: `#${s.id}`, icon: '' });
  return [...bySlot.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1]);
}

// Rotasjon lagres som { steps: [{skill, note}], upkeep: [{skill, boon}] }. Gamle lagringer var en ren liste.
function normalizeRotation(r) {
  if (!r) return { steps: [], upkeep: [] };
  if (Array.isArray(r)) return { steps: r, upkeep: [] };
  return { steps: r.steps || [], upkeep: r.upkeep || [] };
}

/**
 * opts.tab: build-fane å vise (for redigering). Uten: den aktive fanen, kontrollert mot spec fra MumbleLink.
 */
async function getSkillbar(config, snap, mumble, opts = {}) {
  const ident = mumble?.identity;
  if (!ident?.name) return { ok: false, error: 'Ingen karakter fra spillet ennå (MumbleLink). Gå inn i verden med en karakter.' };
  if (!config.apiKey) return { ok: false, error: 'Ingen API-nøkkel.' };
  const profName = PROF_NAMES[ident.profession] || 'Guardian';
  const liveSpec = ident.spec || 0;
  const idx = await fetchIndex();
  const [prof, buildTabs, eqTabs] = await Promise.all([
    profession(profName),
    gw2.get(`/characters/${encodeURIComponent(ident.name)}/buildtabs`, { key: config.apiKey, params: { tabs: 'all' } }).catch(() => []),
    gw2.get(`/characters/${encodeURIComponent(ident.name)}/equipmenttabs`, { key: config.apiKey, params: { tabs: 'all' } }).catch(() => []),
  ]);
  if (!buildTabs.length) return { ok: false, error: 'Fikk ingen builds fra API-et. Nøkkelen trenger tillatelsen builds.' };

  // Velg build-fane: ønsket fane, ellers den aktive hvis spec stemmer med spillet, ellers første fane med samme elite-spec
  const eliteOf = (t) => (t.build?.specializations || []).map((s) => s?.id).find((id) => id && id >= 27 && id !== 0) || 0;
  let tab = opts.tab != null ? buildTabs.find((t) => t.tab === Number(opts.tab)) : null;
  if (!tab) {
    const active = buildTabs.find((t) => t.is_active);
    if (active && (!liveSpec || eliteOf(active) === liveSpec || !eliteOf(active))) tab = active;
    else tab = buildTabs.find((t) => eliteOf(t) === liveSpec) || active || buildTabs[0];
  }
  const build = tab.build || {};
  const specId = eliteOf(tab) || liveSpec;
  const spec = await specialization(specId);
  const key = `${ident.name}|tab${tab.tab}`;
  const legacyKey = `${ident.name}|${specId}`;

  const eq = (eqTabs.find((t) => t.is_active) || eqTabs[0])?.equipment || [];
  const slotItem = (slot) => eq.find((e) => e.slot === slot);
  const items = await gw2.fetchItems(['WeaponA1', 'WeaponA2', 'WeaponB1', 'WeaponB2'].map((sl) => slotItem(sl)?.id).filter(Boolean));
  const typeOf = (sl) => items.get(slotItem(sl)?.id)?.details?.type || '';
  const TWO_HANDED = ['Greatsword', 'Hammer', 'Longbow', 'Rifle', 'Shortbow', 'Staff', 'Spear', 'Speargun', 'Trident'];
  const attunement = 'Fire';
  const buildSet = (mainSlot, offSlot) => {
    const mainType = typeOf(mainSlot), offType = typeOf(offSlot);
    const twoHanded = TWO_HANDED.includes(mainType);
    let w = weaponSkillsFor(prof, mainType, twoHanded ? 'both' : 'main', specId, idx, attunement);
    if (!twoHanded) w = w.concat(weaponSkillsFor(prof, offType, 'off', specId, idx, attunement));
    while (w.length < 5) w.push(null);
    return { mainType, offType, types: [mainType, offType].filter(Boolean), skills: w.slice(0, 5) };
  };
  const sets = { A: buildSet('WeaponA1', 'WeaponA2'), B: buildSet('WeaponB1', 'WeaponB2') };
  if (!sets.B.types.length) sets.B = null;
  const wantSet = opts.set && sets[opts.set] ? opts.set : (snap?.weaponSet === 'B' && sets.B ? 'B' : 'A');
  const cur = sets[wantSet];
  const mainType = cur.mainType, offType = cur.offType;
  const weapon = cur.skills;

  // Profesjonsmekanikk: våpenbundne kjerne-skills etter utstyrt våpen, elite-spec sine erstatter kjernen
  const core = (prof.skills || []).filter((s) => String(s.slot || '').startsWith('Profession_')).map((s) => idx.byId[s.id]).filter(Boolean)
    .filter((s) => !s.weapon_type || s.weapon_type === mainType || s.weapon_type === offType)
    .sort((a, b) => (b.weapon_type ? 1 : 0) - (a.weapon_type ? 1 : 0));
  const eliteMech = specId ? Object.values(idx.byId).filter((s) => s.specialization === specId && s.slot.startsWith('Profession_') && s.professions.includes(profName)) : [];
  const mech = new Map();
  for (const s of core) if (!mech.has(s.slot)) mech.set(s.slot, s);
  for (const s of eliteMech) mech.set(s.slot, s);
  const professionSkills = [...mech.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1]).slice(0, 5);

  const pick = (id) => (id ? idx.byId[id] || { id, name: `#${id}`, icon: '' } : null);
  const rotations = config.rotations || {};
  const setKey = (st) => `${key}|${(st?.types || []).join('+') || 'ingen'}`;
  const rotationFor = (st) => normalizeRotation(rotations[setKey(st)] || rotations[key] || rotations[legacyKey]);
  const bar = {
    ok: true, key: setKey(cur), buildKey: key, weaponSet: wantSet, character: ident.name, professionName: profName, specId, specName: spec?.name || '',
    sets: { A: { types: sets.A.types, key: setKey(sets.A), rotation: rotationFor(sets.A), skills: sets.A.skills }, B: sets.B ? { types: sets.B.types, key: setKey(sets.B), rotation: rotationFor(sets.B), skills: sets.B.skills } : null },
    tab: tab.tab, buildName: tab.name || `Build ${tab.tab}`, isActiveTab: !!tab.is_active,
    builds: buildTabs.map((t) => ({ tab: t.tab, name: t.name || `Build ${t.tab}`, active: !!t.is_active, spec: eliteOf(t) })),
    profession: professionSkills, weapon, heal: pick(build.skills?.heal), utilities: [0, 1, 2].map((i) => pick(build.skills?.utilities?.[i])), elite: pick(build.skills?.elite),
    weaponTypes: [mainType, offType].filter(Boolean),
    rotation: rotationFor(cur),
  };
  bar.all = [...bar.profession, ...bar.weapon, bar.heal, ...bar.utilities, bar.elite].filter(Boolean);
  // Forslag til "hold oppe": skills som gir boons ifølge API-et
  bar.upkeepSuggestions = bar.all.filter((s) => (s.buffs || []).some((b) => BOON_NAMES.includes(b))).map((s) => ({ skill: s.id, boons: s.buffs.filter((b) => BOON_NAMES.includes(b)) }));
  bar.boonNames = BOON_NAMES;
  lastBar.set(bar.key, bar);
  return bar;
}

const ROT_SCHEMA = {
  name: 'rotasjon',
  schema: {
    type: 'object',
    properties: {
      rotasjon: { type: 'array', items: { type: 'object', properties: { skill: { type: 'integer' }, note: { type: 'string' } }, required: ['skill', 'note'], additionalProperties: false } },
      forklaring: { type: 'string' },
    },
    required: ['rotasjon', 'forklaring'], additionalProperties: false,
  },
};

async function suggestRotation(config, key, opts = {}) {
  const bar = lastBar.get(key);
  if (!bar) throw new Error('Hent skill-baren først.');
  const lines = bar.all.map((s) => `- id ${s.id}: ${s.name} (${s.slot || s.type}${s.recharge ? ', cooldown ' + s.recharge + 's' : ''}${s.buffs?.length ? ', gir ' + s.buffs.join('/') : ''}): ${s.description}`);
  const messages = [
    { role: 'system', content: 'Du er en erfaren Guild Wars 2-spiller. Foreslå en praktisk skill-rotasjon for PvE ut fra skillene under. Bruk bare id-er fra lista. Svar på norsk. Vær ærlig i forklaringen om at dette er et forslag og ikke en benchmark-rotasjon.' },
    { role: 'user', content: `Karakter: ${bar.character}, ${bar.professionName}${bar.specName ? ' (' + bar.specName + ')' : ''}, build «${bar.buildName}», våpen: ${bar.weaponTypes.join(' + ') || 'ukjent'}.\nSkills:\n${lines.join('\n')}\n\nLag en rotasjon på 8 til 16 steg som JSON: rotasjon = liste av { skill: id, note: kort merknad }, pluss forklaring.` },
  ];
  const text = await ai.completeText(config, messages, { jsonSchema: ROT_SCHEMA, maxTokens: 6000, onProgress: opts.onProgress });
  const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
  const valid = new Set(bar.all.map((s) => s.id));
  j.rotasjon = (j.rotasjon || []).filter((r) => valid.has(r.skill)).map((r) => ({ skill: r.skill, note: String(r.note || '').slice(0, 80) }));
  return j;
}

module.exports = { getSkillbar, suggestRotation, fetchIndex, normalizeRotation };
