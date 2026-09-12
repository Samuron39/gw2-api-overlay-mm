'use strict';
// Skill-bar: hvilke skills karakteren du spiller har nå (våpen, heal/utility/elite og profesjonsmekanikk F1–F5),
// med ikoner, cooldown og hvilke boons de gir, fra API-et. Alle lagrede builds hentes, rotasjon lagres per build.
// Profesjonsvarianter, alt datadrevet fra API-et: Elementalist får våpenskills per attunement (og Weaver sine dual-skills),
// Engineer-kits og andre bundles fra bundle_skills, Revenant-legends fra /v2/legends, shroud og andre transformasjoner
// fra transform_skills, ladninger (ammo) fra "Maximum Count"/"Count Recharge" og trait-avhengige fakta fra traited_facts.
// Hva som er aktivt akkurat nå (attunement, kit, legend, shroud) velges i overlayen ut fra live-tilstanden (renderer/skillbar-logic.js).
const fs = require('fs');
const path = require('path');
const gw2 = require('../gw2');
const ai = require('../ai');
const { t } = require('../i18n');

const PROF_NAMES = { 1: 'Guardian', 2: 'Warrior', 3: 'Engineer', 4: 'Ranger', 5: 'Thief', 6: 'Elementalist', 7: 'Mesmer', 8: 'Necromancer', 9: 'Revenant' };
const BOON_NAMES = ['Might', 'Fury', 'Quickness', 'Alacrity', 'Protection', 'Regeneration', 'Swiftness', 'Vigor', 'Stability', 'Aegis', 'Resolution', 'Resistance'];
const ELEMENTS = ['Fire', 'Water', 'Air', 'Earth'];
const WEAPON_SLOTS = ['Weapon_1', 'Weapon_2', 'Weapon_3', 'Weapon_4', 'Weapon_5'];
// Skills 1–5 i en transformasjon: API-et legger shroud-skills 1–4 i Downed_1–4 og 5 i Weapon_5, bundles i Weapon_1–5
const FORM_SLOT_INDEX = { Downed_1: 0, Downed_2: 1, Downed_3: 2, Downed_4: 3, Weapon_1: 0, Weapon_2: 1, Weapon_3: 2, Weapon_4: 3, Weapon_5: 4 };
let index = null;
let legendsData = null;
const profCache = new Map();
const specCache = new Map();
const lastBar = new Map(); // key -> skillbar

function cacheFile() { try { return path.join(require('electron').app.getPath('userData'), 'skills-index-v3.json'); } catch { return null; } }

function slim(s) {
  const facts = s.facts || [];
  const recharge = facts.find((f) => f.type === 'Recharge')?.value || 0;
  const buffs = [...new Set(facts.filter((f) => f.type === 'Buff' && f.status).map((f) => f.status))];
  // Ladninger: "Maximum Count" er antall, "Count Recharge" sekunder per ladning
  const ammoCount = facts.find((f) => f.type === 'Number' && f.text === 'Maximum Count')?.value || 0;
  const ammoRecharge = facts.find((f) => f.type === 'Time' && f.text === 'Count Recharge')?.duration || 0;
  // Trait-avhengige fakta som påvirker cooldown eller ladninger (API-et har per i dag bare "Count Recharge" her, Recharge tas med om det kommer)
  const traited = (s.traited_facts || []).filter((f) => f.requires_trait && (f.type === 'Recharge' || f.text === 'Count Recharge'))
    .map((f) => ({ type: f.type, text: f.text, value: f.value, duration: f.duration, requires_trait: f.requires_trait }));
  const weaponType = s.weapon_type && s.weapon_type !== 'None' ? s.weapon_type : '';
  return {
    id: s.id, name: s.name, icon: s.icon, slot: s.slot || '', type: s.type || '', weapon_type: weaponType, professions: s.professions || [], specialization: s.specialization || 0,
    recharge, buffs, description: (s.description || '').replace(/<[^>]+>/g, '').slice(0, 220), attunement: s.attunement || '', dual_attunement: s.dual_attunement || '', dual_wield: s.dual_wield || '',
    flags: s.flags || [], categories: s.categories || [], chat_link: s.chat_link,
    flip_skill: s.flip_skill || 0, toolbelt_skill: s.toolbelt_skill || 0, bundle_skills: s.bundle_skills || null, transform_skills: s.transform_skills || null,
    ammo: ammoCount ? { count: ammoCount, recharge: ammoRecharge } : null, traited,
  };
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
async function legends() {
  if (legendsData) return legendsData;
  try { legendsData = await gw2.get('/legends', { params: { ids: 'all' } }); } catch { legendsData = []; }
  return legendsData;
}

function weaponSkillsFor(prof, weaponType, hand, specId, idx, attunement) {
  const w = prof.weapons?.[weaponType];
  if (!w) return [];
  const list = (w.skills || []).filter((s) => {
    const sk = idx.byId[s.id];
    if (sk?.specialization && sk.specialization !== specId) return false;
    if (sk?.dual_attunement) return false; // Weaver sine dual-skills velges separat (dualSkillsFor)
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

// Weaver: skill 3 avhenger av begge attunements. { 'Fire/Water': skill, ... } med hovedhånd/offhånd.
function dualSkillsFor(prof, weaponType, specId, idx) {
  const out = {};
  for (const s of prof.weapons?.[weaponType]?.skills || []) {
    const sk = idx.byId[s.id];
    if (!sk?.dual_attunement || sk.specialization !== specId || s.slot !== 'Weapon_3') continue;
    const key = `${sk.attunement || s.attunement}/${sk.dual_attunement}`;
    if (!out[key]) out[key] = sk;
  }
  return out;
}

// Har profesjonen attunements? (våpenskills med attunement-felt i /v2/professions)
function hasAttunements(prof) { return Object.values(prof.weapons || {}).some((w) => (w.skills || []).some((s) => s.attunement)); }

// Attunement-skillenes id-er -> element, for å kjenne igjen aktiveringer fra broen
function attunementIdsFor(idx, profName) {
  const out = {};
  for (const s of Object.values(idx.byId)) {
    if (!s.professions.includes(profName) || !s.slot.startsWith('Profession_')) continue;
    const m = /^(Fire|Water|Air|Earth) Attunement$/.exec(s.name);
    if (m) out[s.id] = m[1];
  }
  return out;
}

// Ett skill per slot: foretrekk landversjonen (flagget NoUnderwater), ellers den siste i lista (API-et lister vannversjonen først)
function bySlotPreferLand(list) {
  const m = new Map();
  for (const s of list) { const cur = m.get(s.slot); if (!cur || !(cur.flags || []).includes('NoUnderwater')) m.set(s.slot, s); }
  return m;
}

// Skills 1–5 fra en liste med skill-id-er (bundle_skills/transform_skills). Flip-mål (f.eks. kjedeskill 2 og 3) hoppes over.
function slotSkills(ids, idx, filter) {
  const pool = (ids || []).map((id) => idx.byId[id]).filter(Boolean).filter((s) => FORM_SLOT_INDEX[s.slot] != null && (!filter || filter(s)));
  const flipTargets = new Set(pool.map((s) => s.flip_skill).filter(Boolean));
  const base = pool.filter((s) => !flipTargets.has(s.id));
  const out = [null, null, null, null, null];
  for (const [slot, s] of bySlotPreferLand(base.length ? base : pool)) out[FORM_SLOT_INDEX[slot]] = s;
  return out;
}

// Kits og andre bundles: heal/utility/elite-skills med bundle_skills erstatter våpenskills 1–5 mens de er aktive.
// { skillId: { id, name, ids: [alle id-er som starter kitet], stow: [id-er som legger det bort], skills: [5] } }
function kitsFor(skillIds, idx) {
  const kits = {};
  for (const id of skillIds || []) {
    const s = idx.byId[id];
    if (!s?.bundle_skills?.length) continue;
    const skills = slotSkills(s.bundle_skills, idx, (b) => WEAPON_SLOTS.includes(b.slot));
    if (!skills.some(Boolean)) continue;
    // Samme kit finnes med flere id-er i API-et (5805 og 6020 er begge Grenade Kit); alle starter det
    const aliases = Object.values(idx.byId).filter((o) => o.name === s.name && o.bundle_skills && o.professions.join() === s.professions.join());
    const ids = [...new Set([id, ...aliases.map((o) => o.id)])];
    const stow = [...new Set(aliases.map((o) => o.flip_skill).concat(s.flip_skill).filter(Boolean))];
    kits[id] = { id, name: s.name, ids, stow, skills };
  }
  return kits;
}

// Revenant: skills per legend fra /v2/legends. build.legends er ["Legend2", ...] (tall godtas også).
function legendsFor(buildLegends, legendData, idx) {
  const out = {};
  const order = [];
  const pick = (id) => (id ? idx.byId[id] || { id, name: `#${id}`, icon: '' } : null);
  for (const raw of buildLegends || []) {
    if (!raw) continue;
    const key = typeof raw === 'number' ? `Legend${raw}` : String(raw);
    const l = (legendData || []).find((x) => x.id === key);
    if (!l || out[key]) continue;
    const swapSkill = pick(l.swap);
    out[key] = { key, name: swapSkill?.name || key, swap: l.swap, swapSkill, heal: pick(l.heal), utilities: [0, 1, 2].map((i) => pick(l.utilities?.[i])), elite: pick(l.elite) };
    order.push(key);
  }
  return { legends: out, order };
}

/**
 * Profesjonsmekanikk (F1–F5) og transformasjoner for builden.
 * - Kjerne-skills fra /v2/professions, våpenbundne etter utstyrt våpen. Flere varianter i samme slot uten specialization-felt
 *   (Death Shroud / Reaper's Shroud / Harbinger Shroud) skilles på navn mot elite-spec-navnene i training.
 * - Elite-spec sine skills (specialization = builden) erstatter kjernen i samme slot.
 * - Berserker: primal bursts (kategori PrimalBurst) vises bare i Berserk-modus, som en form med Berserk-skillets navn.
 * - Shroud/Celestial Avatar: skills 1–5 fra transform_skills på mekanikk-skillet (alle necro-varianter ligger på Death Shroud).
 * - Elite-transformasjoner (Tornado, Lich Form, Rampage): fra elite-skillets transform_skills.
 */
function mechanicsFor({ prof, profName, specId, specName, idx, mainType, offType, elite, toolbelt }) {
  const isProfSlot = (s) => String(s?.slot || '').startsWith('Profession_');
  const fitsWeapon = (s) => !s.weapon_type || s.weapon_type === mainType || s.weapon_type === offType;
  const eliteNames = (prof.training || []).filter((t) => t.category === 'EliteSpecializations').map((t) => String(t.name).toLowerCase());
  const specLower = String(specName || '').toLowerCase();
  const namedFor = (s, n) => !!n && s.name.toLowerCase().includes(n);
  // Flere varianter i samme slot: hopp over flip-mål (Exit/Stow/Deactivate-skills og senere kjedeledd) og foretrekk inngangsskillet som har flip_skill
  const entries = (list) => { const targets = new Set(list.map((s) => s.flip_skill).filter(Boolean)); return list.filter((s) => !targets.has(s.id)).sort((a, b) => (a.flip_skill ? 0 : 1) - (b.flip_skill ? 0 : 1)); };
  const core = entries((prof.skills || []).filter(isProfSlot).map((s) => idx.byId[s.id]).filter(Boolean)
    .filter((s) => (!s.specialization || s.specialization === specId) && fitsWeapon(s))
    .filter((s) => !eliteNames.some((n) => n !== specLower && namedFor(s, n))))
    .sort((a, b) => ((b.weapon_type ? 1 : 0) - (a.weapon_type ? 1 : 0)) || ((namedFor(b, specLower) ? 1 : 0) - (namedFor(a, specLower) ? 1 : 0)));
  const eliteAll = specId ? entries(Object.values(idx.byId).filter((s) => s.specialization === specId && isProfSlot(s) && s.professions.includes(profName) && fitsWeapon(s))) : [];
  const primal = eliteAll.filter((s) => (s.categories || []).includes('PrimalBurst'));
  const rage = eliteAll.find((s) => (s.categories || []).includes('Rage'));
  const mech = new Map();
  // Engineer: F1–F5 er toolbelt-skillene til heal, utility 1–3 og elite (toolbelt_skill i API-et). Elite-spec overstyrer slot for slot.
  (toolbelt || []).forEach((s, i) => { if (s) mech.set(`Profession_${i + 1}`, { ...s, slot: `Profession_${i + 1}` }); });
  for (const s of core) if (!mech.has(s.slot)) mech.set(s.slot, s);
  for (const s of eliteAll) if (!primal.includes(s) && (!mech.has(s.slot) || !mech.get(s.slot).specialization)) mech.set(s.slot, s);
  const profession = [...mech.entries()].sort((a, b) => a[0].localeCompare(b[0])).map((e) => e[1]).slice(0, 5);

  const forms = {};
  if (primal.length && rage) forms[rage.name] = { profession: [...bySlotPreferLand(primal).values()] };
  const pools = (prof.skills || []).filter(isProfSlot).map((s) => idx.byId[s.id]).filter((s) => s?.transform_skills?.length);
  const mechForm = profession.find((s) => s.transform_skills?.length) || profession.find((s) => /Shroud/.test(s.name));
  if (mechForm && pools.length) {
    const poolAll = [...new Set(pools.flatMap((p) => p.transform_skills))].map((id) => idx.byId[id]).filter((s) => s && s.type === 'Profession');
    const specific = poolAll.filter((s) => specId && s.specialization === specId);
    const pool = specific.length ? specific : poolAll.filter((s) => !s.specialization);
    const weapon = slotSkills(pool.map((s) => s.id), idx);
    if (weapon.filter(Boolean).length >= 4) {
      const flipTargets = new Set(pool.map((s) => s.flip_skill).filter(Boolean));
      // F2–F5 inne i formen (Ritualist sine Innervate-skills). F1 er alltid selve shroud-skillet, som blir avslutt-skillet.
      const profOverride = [...bySlotPreferLand(pool.filter((s) => isProfSlot(s) && s.slot !== 'Profession_1' && !flipTargets.has(s.id))).values()];
      forms[mechForm.name] = { weapon, profession: profOverride };
    }
  }
  if (elite?.transform_skills?.length) {
    const weapon = slotSkills(elite.transform_skills, idx);
    if (weapon.filter(Boolean).length >= 3) forms[elite.name] = { weapon };
  }
  return { profession, forms };
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
  if (!ident?.name) return { ok: false, error: t('skills.noCharacter') };
  if (!config.apiKey) return { ok: false, error: t('common.noApiKeyShort') };
  const profName = PROF_NAMES[ident.profession] || 'Guardian';
  const liveSpec = ident.spec || 0;
  const idx = await fetchIndex();
  const [prof, buildTabs, eqTabs] = await Promise.all([
    profession(profName),
    gw2.get(`/characters/${encodeURIComponent(ident.name)}/buildtabs`, { key: config.apiKey, params: { tabs: 'all' } }).catch(() => []),
    gw2.get(`/characters/${encodeURIComponent(ident.name)}/equipmenttabs`, { key: config.apiKey, params: { tabs: 'all' } }).catch(() => []),
  ]);
  if (!buildTabs.length) return { ok: false, error: t('skills.noBuilds') };

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
  const traits = (build.specializations || []).flatMap((s) => s?.traits || []).filter(Boolean);

  const eq = (eqTabs.find((t) => t.is_active) || eqTabs[0])?.equipment || [];
  const slotItem = (slot) => eq.find((e) => e.slot === slot);
  const items = await gw2.fetchItems(['WeaponA1', 'WeaponA2', 'WeaponB1', 'WeaponB2'].map((sl) => slotItem(sl)?.id).filter(Boolean));
  const typeOf = (sl) => items.get(slotItem(sl)?.id)?.details?.type || '';
  const TWO_HANDED = ['Greatsword', 'Hammer', 'Longbow', 'Rifle', 'Shortbow', 'Staff', 'Spear', 'Speargun', 'Trident'];
  const elemental = hasAttunements(prof);
  const buildSet = (mainSlot, offSlot) => {
    const mainType = typeOf(mainSlot), offType = typeOf(offSlot);
    const twoHanded = TWO_HANDED.includes(mainType);
    const one = (att) => {
      let w = weaponSkillsFor(prof, mainType, twoHanded ? 'both' : 'main', specId, idx, att);
      if (!twoHanded) w = w.concat(weaponSkillsFor(prof, offType, 'off', specId, idx, att));
      while (w.length < 5) w.push(null);
      return w.slice(0, 5);
    };
    const set = { mainType, offType, types: [mainType, offType].filter(Boolean), skills: one(ELEMENTS[0]) };
    if (elemental) {
      // Alle fire attunements; overlayen velger etter aktiv attunement. Weaver får i tillegg dual-skills for slot 3.
      set.attunements = Object.fromEntries(ELEMENTS.map((el) => [el, one(el)]));
      const dual = dualSkillsFor(prof, mainType, specId, idx);
      if (Object.keys(dual).length) set.dual = dual;
    }
    return set;
  };
  const sets = { A: buildSet('WeaponA1', 'WeaponA2'), B: buildSet('WeaponB1', 'WeaponB2') };
  if (!sets.B.types.length) sets.B = null;
  const wantSet = opts.set && sets[opts.set] ? opts.set : (snap?.weaponSet === 'B' && sets.B ? 'B' : 'A');
  const cur = sets[wantSet];
  const mainType = cur.mainType, offType = cur.offType;
  const weapon = cur.skills;

  const pick = (id) => (id ? idx.byId[id] || { id, name: `#${id}`, icon: '' } : null);
  const heal = pick(build.skills?.heal);
  const utilities = [0, 1, 2].map((i) => pick(build.skills?.utilities?.[i]));
  const elite = pick(build.skills?.elite);

  // Profesjonsmekanikk og transformasjoner (shroud, Berserk, elite-transformasjoner). Engineer: toolbelt-skills fra heal/utility/elite.
  const toolbeltOf = (s) => (s?.toolbelt_skill ? pick(s.toolbelt_skill) : null);
  const toolbelt = [heal, ...utilities, elite].map(toolbeltOf);
  const { profession: professionSkills, forms } = mechanicsFor({ prof, profName, specId, specName: spec?.name, idx, mainType, offType, elite, toolbelt: toolbelt.some(Boolean) ? toolbelt : null });

  // Revenant: skills per legend, F1 er den inaktive legendens stance-skill
  const legendInfo = build.legends?.length ? legendsFor(build.legends, await legends(), idx) : { legends: {}, order: [] };
  if (legendInfo.order.length > 1) {
    const other = legendInfo.legends[legendInfo.order[1]];
    const i = professionSkills.findIndex((s) => s.slot === 'Profession_1');
    if (other?.swapSkill) { if (i >= 0) professionSkills[i] = other.swapSkill; else professionSkills.unshift(other.swapSkill); }
  }

  // Kits og bundles fra heal/utility/elite, også fra alle legender
  const kitCandidates = [heal, ...utilities, elite, ...Object.values(legendInfo.legends).flatMap((l) => [l.heal, ...l.utilities, l.elite])].filter(Boolean).map((s) => s.id);
  const kits = kitsFor(kitCandidates, idx);

  const rotations = config.rotations || {};
  const setKey = (st) => `${key}|${(st?.types || []).join('+') || 'ingen'}`;
  const rotationFor = (st) => normalizeRotation(rotations[setKey(st)] || rotations[key] || rotations[legacyKey]);
  const setOut = (st) => ({ types: st.types, key: setKey(st), rotation: rotationFor(st), skills: st.skills, attunements: st.attunements || null, dual: st.dual || null });
  const bar = {
    ok: true, key: setKey(cur), buildKey: key, weaponSet: wantSet, character: ident.name, professionName: profName, specId, specName: spec?.name || '',
    sets: { A: setOut(sets.A), B: sets.B ? setOut(sets.B) : null },
    tab: tab.tab, buildName: tab.name || t('skills.buildFallback', { tab: tab.tab }), isActiveTab: !!tab.is_active,
    builds: buildTabs.map((b) => ({ tab: b.tab, name: b.name || t('skills.buildFallback', { tab: b.tab }), active: !!b.is_active, spec: eliteOf(b) })),
    profession: professionSkills, weapon, heal, utilities, elite,
    weaponTypes: [mainType, offType].filter(Boolean),
    rotation: rotationFor(cur),
    traits,
    attunementIds: elemental ? attunementIdsFor(idx, profName) : null,
    kits, legends: legendInfo.legends, legendOrder: legendInfo.order, forms,
  };
  const extra = [
    ...Object.values(cur.attunements || {}).flat(), ...Object.values(cur.dual || {}),
    ...Object.values(kits).flatMap((k) => k.skills),
    ...Object.values(legendInfo.legends).flatMap((l) => [l.swapSkill, l.heal, ...l.utilities, l.elite]),
    ...Object.values(forms).flatMap((f) => [...(f.weapon || []), ...(f.profession || [])]),
  ];
  const seen = new Set();
  bar.all = [...bar.profession, ...bar.weapon, bar.heal, ...bar.utilities, bar.elite, ...extra].filter((s) => s && !seen.has(s.id) && seen.add(s.id));
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
  if (!bar) throw new Error(t('skills.fetchFirst'));
  const lines = bar.all.map((s) => `- id ${s.id}: ${s.name} (${s.slot || s.type}${s.attunement ? ', ' + s.attunement : ''}${s.recharge ? ', cooldown ' + s.recharge + 's' : ''}${s.ammo ? ', ' + s.ammo.count + ' ladninger' : ''}${s.buffs?.length ? ', gir ' + s.buffs.join('/') : ''}): ${s.description}`);
  const messages = [
    { role: 'system', content: `Du er en erfaren Guild Wars 2-spiller. Foreslå en praktisk skill-rotasjon for PvE ut fra skillene under. Bruk bare id-er fra lista. Svar på ${ai.answerLanguage()}. Vær ærlig i forklaringen om at dette er et forslag og ikke en benchmark-rotasjon.` },
    { role: 'user', content: `Karakter: ${bar.character}, ${bar.professionName}${bar.specName ? ' (' + bar.specName + ')' : ''}, build «${bar.buildName}», våpen: ${bar.weaponTypes.join(' + ') || 'ukjent'}.\nSkills:\n${lines.join('\n')}\n\nLag en rotasjon på 8 til 16 steg som JSON: rotasjon = liste av { skill: id, note: kort merknad }, pluss forklaring.` },
  ];
  const text = await ai.completeText(config, messages, { jsonSchema: ROT_SCHEMA, maxTokens: 6000, onProgress: opts.onProgress });
  const j = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
  const valid = new Set(bar.all.map((s) => s.id));
  j.rotasjon = (j.rotasjon || []).filter((r) => valid.has(r.skill)).map((r) => ({ skill: r.skill, note: String(r.note || '').slice(0, 80) }));
  return j;
}

module.exports = {
  getSkillbar, suggestRotation, fetchIndex, normalizeRotation,
  // Rene hjelpere, eksportert for tester
  slim, weaponSkillsFor, dualSkillsFor, hasAttunements, attunementIdsFor, slotSkills, kitsFor, legendsFor, mechanicsFor,
};
