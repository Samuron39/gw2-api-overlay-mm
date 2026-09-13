'use strict';
// Enhetstester for skill-baren: rene funksjoner i renderer/skillbar-logic.js (velg attunement, kit, legend, form,
// cooldown med trait, ladninger) og hjelperne i modules/skills.js (attunement-sett, kits, legends, mekanikk/shroud),
// med syntetiske data etter samme form som /v2/skills, /v2/professions og /v2/legends.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/renderer/skillbar-logic.js');
const S = require('../src/modules/skills.js');

const buff = (name, skill = 0) => ({ skill, name, stacks: 1, remainingMs: 5000 });
const fired = (skill, sinceMs) => ({ skill, fired: true, sinceMs, castStart: 1000 - sinceMs });

test('hold-oppe: en boon regnes som borte først når den ikke er sett på delayMs', () => {
  const upkeep = [{ skill: 1, boon: 'Might' }, { skill: 2, boon: 'Fury' }];
  const seen = new Map();
  // Tilkobling ved t=0: ingenting sett ennå, men toleransen gjelder fra start
  assert.deepEqual(L.upkeepMissing(upkeep, 1, seen, 0, 1000, 3000), []);
  assert.deepEqual(L.upkeepMissing(upkeep, 1, seen, 0, 3001, 3000), ['Might']);
  // Might sett ved t=5000: borte først etter 8000
  L.noteBoons([buff('Might')], seen, 5000);
  assert.deepEqual(L.upkeepMissing(upkeep, 1, seen, 0, 7900, 3000), []);
  assert.deepEqual(L.upkeepMissing(upkeep, 1, seen, 0, 8001, 3000), ['Might']);
  // Fury med lite tid igjen teller ikke som sett
  L.noteBoons([{ name: 'Fury', remainingMs: 500 }], seen, 9000);
  assert.deepEqual(L.upkeepMissing(upkeep, 2, seen, 0, 9000, 3000), ['Fury']);
  // delayMs 0 = som før: mangler med en gang
  assert.deepEqual(L.upkeepMissing(upkeep, 1, seen, 0, 8001, 0), ['Might']);
});

test('parseAttunement leser kjerne-, Weaver- og dual-buffer', () => {
  assert.deepEqual(L.parseAttunement('Fire Attunement'), { main: 'Fire', off: null });
  assert.deepEqual(L.parseAttunement('Fire Water Attunement'), { main: 'Fire', off: 'Water' });
  assert.deepEqual(L.parseAttunement('Dual Earth Attunement'), { main: 'Earth', off: 'Earth' });
  assert.equal(L.parseAttunement('Might'), null);
  assert.equal(L.parseAttunement('Glyph of Elemental Power'), null);
});

test('pickAttunement: buff først, så sist aktiverte attunement-skills, ellers Fire', () => {
  const ids = { 5492: 'Fire', 5493: 'Water', 5494: 'Air', 5495: 'Earth' };
  assert.deepEqual(L.pickAttunement({ buffs: [buff('Might'), buff('Air Attunement')] }, ids), { main: 'Air', off: null });
  // Weaver: nyeste aktivering er hovedhånd, forrige er offhånd
  assert.deepEqual(L.pickAttunement({ buffs: [], cooldowns: [fired(5493, 9000), fired(5492, 2000), fired(999, 100)] }, ids), { main: 'Fire', off: 'Water' });
  assert.deepEqual(L.pickAttunement({ buffs: [], cooldowns: [] }, ids), { main: 'Fire', off: null });
  assert.deepEqual(L.pickAttunement(null, ids), { main: 'Fire', off: null });
});

test('attunementWeapon: per attunement, Weaver blander hovedhånd, dual og offhånd', () => {
  const sk = (id) => ({ id, name: 's' + id });
  const set = { attunements: { Fire: [sk(1), sk(2), sk(3), sk(4), sk(5)], Water: [sk(11), sk(12), sk(13), sk(14), sk(15)] } };
  assert.deepEqual(L.attunementWeapon(set, 'Water', null).map((s) => s.id), [11, 12, 13, 14, 15]);
  assert.deepEqual(L.attunementWeapon(set, 'Ukjent', null).map((s) => s.id), [1, 2, 3, 4, 5]);
  const weaver = { ...set, dual: { 'Fire/Water': sk(99) } };
  assert.deepEqual(L.attunementWeapon(weaver, 'Fire', 'Water').map((s) => s.id), [1, 2, 99, 14, 15]);
  assert.deepEqual(L.attunementWeapon(weaver, 'Water', 'Fire').map((s) => s.id), [11, 12, 13, 4, 5]); // ingen dual-skill for Water/Fire: vanlig 3
  assert.deepEqual(L.attunementWeapon(weaver, 'Fire', 'Fire').map((s) => s.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(L.attunementWeapon({ skills: [sk(7)] }, 'Fire', null).map((s) => s.id), [7]); // ikke Elementalist
});

test('pickKit: buff med kitets navn, ellers siste kit-/stow-aktivering', () => {
  const kits = { 5805: { id: 5805, name: 'Grenade Kit', ids: [5805, 6020], stow: [6110], skills: [] }, 5933: { id: 5933, name: 'Elixir Gun', ids: [5933], stow: [6115], skills: [] } };
  assert.equal(L.pickKit({ buffs: [buff('Elixir Gun')] }, kits), 5933);
  assert.equal(L.pickKit({ buffs: [], cooldowns: [fired(6020, 3000)] }, kits), 5805);
  assert.equal(L.pickKit({ buffs: [], cooldowns: [fired(5805, 3000), fired(6110, 500)] }, kits), null);
  assert.equal(L.pickKit({ buffs: [], cooldowns: [fired(5805, 3000), fired(5933, 500)] }, kits), 5933);
  assert.equal(L.pickKit({ buffs: [] }, kits), null);
  assert.equal(L.pickKit({ buffs: [buff('Grenade Kit')] }, {}), null);
});

test('pickLegend: stance-buff, ellers siste swap-aktivering, ellers første i builden', () => {
  const legends = { Legend2: { key: 'Legend2', name: 'Legendary Assassin Stance', swap: 28134 }, Legend7: { key: 'Legend7', name: 'Legendary Alliance', swap: 62749 } };
  const order = ['Legend2', 'Legend7'];
  assert.equal(L.pickLegend({ buffs: [buff('Legendary Assassin Stance')] }, legends, order), 'Legend2');
  assert.equal(L.pickLegend({ buffs: [buff('Legendary Alliance Stance')] }, legends, order), 'Legend7'); // navnet i API-et mangler "Stance"
  assert.equal(L.pickLegend({ buffs: [], cooldowns: [fired(28134, 8000), fired(62749, 1000)] }, legends, order), 'Legend7');
  assert.equal(L.pickLegend({ buffs: [] }, legends, order), 'Legend2');
  assert.equal(L.pickLegend({ buffs: [] }, {}, []), null);
});

test('pickForm: eksakt buff-navn, ellers en Shroud-buff når det finnes én shroud-form', () => {
  const forms = { "Reaper's Shroud": { weapon: [] }, Berserk: { profession: [] } };
  assert.equal(L.pickForm({ buffs: [buff('Berserk')] }, forms), 'Berserk');
  assert.equal(L.pickForm({ buffs: [buff("Reaper's Shroud")] }, forms), "Reaper's Shroud");
  assert.equal(L.pickForm({ buffs: [buff('Death Shroud')] }, forms), "Reaper's Shroud");
  assert.equal(L.pickForm({ buffs: [buff('Might')] }, forms), null);
  assert.equal(L.pickForm({ buffs: [buff('Berserk')] }, {}), null);
});

test('cooldownSeconds: Recharge, traited Recharge når builden har traiten, 25 % kortere med alacrity', () => {
  const skill = { recharge: 20, traited: [{ type: 'Recharge', value: 16, requires_trait: 2039 }] };
  assert.equal(L.cooldownSeconds(skill, [], false), 20);
  assert.equal(L.cooldownSeconds(skill, [2039], false), 16);
  assert.equal(L.cooldownSeconds(skill, [2039], true), 12);
  assert.equal(L.cooldownSeconds({ recharge: 8 }, [1], true), 6);
  assert.equal(L.cooldownSeconds(null, [], false), 0);
});

test('ammoFor og ladningstilstand: teller ned per aktivering og lader opp per Count Recharge', () => {
  const skill = { recharge: 1, ammo: { count: 2, recharge: 10 }, traited: [{ type: 'Time', text: 'Count Recharge', duration: 8, requires_trait: 1676 }] };
  assert.equal(L.ammoFor({ recharge: 5 }, [], false), null);
  assert.deepEqual(L.ammoFor(skill, [], false), { count: 2, recharge: 10 });
  assert.deepEqual(L.ammoFor(skill, [1676], false), { count: 2, recharge: 8 });
  assert.deepEqual(L.ammoFor(skill, [1676], true), { count: 2, recharge: 6 });
  assert.deepEqual(L.ammoFor({ recharge: 30, ammo: { count: 3, recharge: 0 } }, [], false), { count: 3, recharge: 30 }); // uten Count Recharge: vanlig Recharge
  let st = L.ammoUse(null, 2, 10000, 0);
  assert.deepEqual(st, { charges: 1, nextAt: 10000 });
  st = L.ammoUse(st, 2, 10000, 1000);
  assert.deepEqual(st, { charges: 0, nextAt: 10000 });
  assert.deepEqual(L.ammoTick(st, 2, 10000, 9999), { charges: 0, nextAt: 10000 });
  assert.deepEqual(L.ammoTick(st, 2, 10000, 10000), { charges: 1, nextAt: 20000 });
  assert.deepEqual(L.ammoTick(st, 2, 10000, 50000), { charges: 2, nextAt: 0 });
  st = L.ammoUse(st, 2, 10000, 50000);
  assert.deepEqual(st, { charges: 1, nextAt: 60000 });
});

// Syntetisk skill-indeks etter formen fra /v2/skills (etter slim)
function makeIndex(list) { const byId = {}; for (const s of list) byId[s.id] = S.slim(s); return { byId }; }
const raw = (id, name, extra = {}) => ({ id, name, icon: 'i' + id, professions: ['Elementalist'], ...extra });

test('slim beholder ammo, traited Count Recharge, bundle/flip/transform og fjerner weapon_type None', () => {
  const s = S.slim(raw(1, 'Water Trident', {
    weapon_type: 'None', flip_skill: 2, bundle_skills: [3], transform_skills: [4], toolbelt_skill: 5, dual_attunement: 'Water', categories: ['Kit'],
    facts: [{ type: 'Recharge', value: 1 }, { type: 'Number', text: 'Maximum Count', value: 2 }, { type: 'Time', text: 'Count Recharge', duration: 10 }, { type: 'Buff', status: 'Might' }],
    traited_facts: [{ type: 'Time', text: 'Count Recharge', duration: 8, requires_trait: 1676 }, { type: 'Damage', requires_trait: 1 }],
  }));
  assert.equal(s.weapon_type, '');
  assert.deepEqual(s.ammo, { count: 2, recharge: 10 });
  assert.deepEqual(s.traited, [{ type: 'Time', text: 'Count Recharge', value: undefined, duration: 8, requires_trait: 1676 }]);
  assert.equal(s.flip_skill, 2); assert.deepEqual(s.bundle_skills, [3]); assert.deepEqual(s.transform_skills, [4]); assert.equal(s.toolbelt_skill, 5);
  assert.equal(s.dual_attunement, 'Water'); assert.deepEqual(s.buffs, ['Might']);
  assert.equal(S.slim(raw(9, 'Kill Shot', { weapon_type: 'Rifle' })).weapon_type, 'Rifle');
  assert.equal(S.slim(raw(10, 'X', { facts: [{ type: 'Recharge', value: 5 }] })).ammo, null);
});

test('weaponSkillsFor og dualSkillsFor: per attunement, Weaver-dual-skills bare for Weaver', () => {
  const idx = makeIndex([
    raw(101, 'Fireball', { slot: 'Weapon_1', attunement: 'Fire' }), raw(102, 'Lava Font', { slot: 'Weapon_2', attunement: 'Fire' }), raw(103, 'Flame Burst', { slot: 'Weapon_3', attunement: 'Fire' }),
    raw(111, 'Water Blast', { slot: 'Weapon_1', attunement: 'Water' }), raw(113, 'Geyser', { slot: 'Weapon_3', attunement: 'Water' }),
    raw(201, 'Pressure Blast', { slot: 'Weapon_3', attunement: 'Fire', dual_attunement: 'Water', specialization: 56 }),
    raw(104, 'Burning Retreat', { slot: 'Weapon_4', attunement: 'Fire' }), raw(105, 'Meteor Shower', { slot: 'Weapon_5', attunement: 'Fire' }),
  ]);
  const prof = { weapons: { Staff: { skills: [101, 102, 103, 111, 113, 201, 104, 105].map((id) => ({ id, slot: idx.byId[id].slot, attunement: idx.byId[id].attunement })) } } };
  assert.equal(S.hasAttunements(prof), true);
  assert.deepEqual(S.weaponSkillsFor(prof, 'Staff', 'both', 0, idx, 'Fire').map((s) => s.id), [101, 102, 103, 104, 105]);
  assert.deepEqual(S.weaponSkillsFor(prof, 'Staff', 'both', 56, idx, 'Fire').map((s) => s.id), [101, 102, 103, 104, 105]); // dual-skillet velges separat
  assert.deepEqual(S.weaponSkillsFor(prof, 'Staff', 'both', 0, idx, 'Water').map((s) => s.id), [111, 113]);
  assert.deepEqual(S.weaponSkillsFor(prof, 'Staff', 'main', 0, idx, 'Fire').map((s) => s.id), [101, 102, 103]);
  assert.deepEqual(Object.keys(S.dualSkillsFor(prof, 'Staff', 56, idx)), ['Fire/Water']);
  assert.deepEqual(S.dualSkillsFor(prof, 'Staff', 0, idx), {});
  assert.deepEqual(S.attunementIdsFor(makeIndex([raw(5492, 'Fire Attunement', { slot: 'Profession_1' }), raw(5493, 'Water Attunement', { slot: 'Profession_2' }), raw(1, 'Fire Attunement', { slot: 'Utility', professions: ['Guardian'] })]), 'Elementalist'), { 5492: 'Fire', 5493: 'Water' });
});

test('kitsFor: bundle_skills gir skills 1–5, landversjon foretrekkes, alias-id-er og stow-skill samles', () => {
  const eng = (id, name, extra) => raw(id, name, { professions: ['Engineer'], ...extra });
  const idx = makeIndex([
    eng(5805, 'Grenade Kit', { type: 'Utility', slot: 'Utility', flip_skill: 6110, bundle_skills: [6171, 5882, 5807, 5808, 5809, 5806] }),
    eng(6020, 'Grenade Kit', { type: 'Utility', slot: 'Utility', bundle_skills: [6171, 5882, 5807, 5808, 5809, 5806], categories: ['Kit'] }),
    eng(6110, 'Stow Grenade Kit', { type: 'Utility', slot: 'Utility' }),
    eng(6171, 'Grenade (vann)', { type: 'Bundle', slot: 'Weapon_1' }), eng(5882, 'Grenade', { type: 'Bundle', slot: 'Weapon_1', flags: ['GroundTargeted', 'NoUnderwater'] }),
    eng(5807, 'Shrapnel Grenade', { type: 'Bundle', slot: 'Weapon_2' }), eng(5808, 'Flash Grenade', { type: 'Bundle', slot: 'Weapon_3' }), eng(5809, 'Freeze Grenade', { type: 'Bundle', slot: 'Weapon_4' }), eng(5806, 'Poison Grenade', { type: 'Bundle', slot: 'Weapon_5' }),
    eng(5927, 'Flamethrower', { type: 'Utility', slot: 'Utility', bundle_skills: [5928] }), eng(5928, 'Flame Jet', { type: 'Bundle', slot: 'Weapon_1' }),
    eng(1, 'Rocket Boots', { type: 'Utility', slot: 'Utility' }),
  ]);
  const kits = S.kitsFor([5805, 5927, 1, null], idx);
  assert.deepEqual(Object.keys(kits).map(Number), [5805, 5927]);
  assert.deepEqual(kits[5805].skills.map((s) => s.id), [5882, 5807, 5808, 5809, 5806]);
  assert.deepEqual(kits[5805].ids.sort(), [5805, 6020]);
  assert.deepEqual(kits[5805].stow, [6110]);
  assert.deepEqual(kits[5927].skills.map((s) => s && s.id), [5928, null, null, null, null]);
});

test('legendsFor: skills per legend fra /v2/legends, strenger eller tall, ukjente hoppes over', () => {
  const rev = (id, name) => raw(id, name, { professions: ['Revenant'] });
  const idx = makeIndex([rev(28134, 'Legendary Assassin Stance'), rev(26937, 'Enchanted Daggers'), rev(28406, 'Jade Winds'), rev(29209, 'Riposting Shadows'), rev(28231, 'Phase Traversal'), rev(27107, 'Impossible Odds'), rev(62749, 'Legendary Alliance')]);
  const data = [{ id: 'Legend2', swap: 28134, heal: 26937, elite: 28406, utilities: [29209, 28231, 27107] }, { id: 'Legend7', swap: 62749, heal: 1, elite: 2, utilities: [3] }];
  const r = S.legendsFor(['Legend2', 7, 'Legend9', null], data, idx);
  assert.deepEqual(r.order, ['Legend2', 'Legend7']);
  assert.equal(r.legends.Legend2.name, 'Legendary Assassin Stance');
  assert.equal(r.legends.Legend2.swap, 28134);
  assert.deepEqual(r.legends.Legend2.utilities.map((s) => s.name), ['Riposting Shadows', 'Phase Traversal', 'Impossible Odds']);
  assert.equal(r.legends.Legend7.heal.name, '#1'); // ukjent skill i indeksen får plassholder
  assert.deepEqual(r.legends.Legend7.utilities.map((s) => s && s.name), ['#3', null, null]);
});

test('mechanicsFor: shroud-variant etter spec-navn, shroud-form fra transform_skills, Berserk-form fra primal bursts', () => {
  const nec = (id, name, extra) => raw(id, name, { professions: ['Necromancer'], type: 'Profession', weapon_type: 'None', ...extra });
  const shroudPool = [10554, 18504, 10690, 10604, 56916, 10588, 10594, 19504, 29442, 29458, 30825, 29958, 29709, 30504, 30557, 30792, 62567];
  const idx = makeIndex([
    nec(10574, 'Death Shroud', { slot: 'Profession_1', flip_skill: 10585, transform_skills: shroudPool }), nec(10585, 'End Death Shroud', { slot: 'Profession_1' }),
    nec(30792, "Reaper's Shroud", { slot: 'Profession_1', flip_skill: 30961 }), nec(62567, 'Harbinger Shroud', { slot: 'Profession_1' }),
    nec(10554, 'Life Blast', { slot: 'Downed_1', flip_skill: 18504, flags: ['NoUnderwater'] }), nec(18504, 'Dhuumfire', { slot: 'Downed_1' }), nec(10690, 'Plague Blast', { slot: 'Downed_1' }),
    nec(10604, 'Dark Path', { slot: 'Downed_2', flip_skill: 56916 }), nec(56916, 'Dark Pursuit', { slot: 'Downed_2' }), nec(10588, 'Doom', { slot: 'Downed_3' }), nec(10594, 'Life Transfer', { slot: 'Downed_4' }), nec(19504, 'Tainted Shackles', { slot: 'Weapon_5' }),
    nec(29442, 'Life Rend', { slot: 'Downed_1', flip_skill: 29458, specialization: 34 }), nec(29458, 'Life Slash', { slot: 'Downed_1', specialization: 34 }), nec(30825, "Death's Charge", { slot: 'Downed_2', specialization: 34 }),
    nec(29958, 'Infusing Terror', { slot: 'Downed_3', flip_skill: 29709, specialization: 34 }), nec(29709, 'Terrify', { slot: 'Downed_3', specialization: 34 }), nec(30504, 'Soul Spiral', { slot: 'Downed_4', specialization: 34 }), nec(30557, "Executioner's Scythe", { slot: 'Weapon_5', specialization: 34 }),
  ]);
  const prof = { skills: [{ id: 10574, slot: 'Profession_1' }, { id: 30792, slot: 'Profession_1' }, { id: 62567, slot: 'Profession_1' }], training: [{ category: 'EliteSpecializations', name: 'Reaper' }, { category: 'EliteSpecializations', name: 'Harbinger' }] };
  const core = S.mechanicsFor({ prof, profName: 'Necromancer', specId: 0, specName: '', idx, mainType: 'Axe', offType: 'Dagger' });
  assert.deepEqual(core.profession.map((s) => s.name), ['Death Shroud']);
  assert.deepEqual(core.forms['Death Shroud'].weapon.map((s) => s.name), ['Life Blast', 'Dark Path', 'Doom', 'Life Transfer', 'Tainted Shackles']);
  const reaper = S.mechanicsFor({ prof, profName: 'Necromancer', specId: 34, specName: 'Reaper', idx, mainType: 'Greatsword', offType: '' });
  assert.deepEqual(reaper.profession.map((s) => s.name), ["Reaper's Shroud"]);
  assert.deepEqual(reaper.forms["Reaper's Shroud"].weapon.map((s) => s.name), ['Life Rend', "Death's Charge", 'Infusing Terror', 'Soul Spiral', "Executioner's Scythe"]);
  assert.equal(reaper.forms['Death Shroud'], undefined);

  const war = (id, name, extra) => raw(id, name, { professions: ['Warrior'], type: 'Profession', ...extra });
  const widx = makeIndex([
    war(14418, 'Eviscerate', { slot: 'Profession_1', weapon_type: 'Axe' }), war(14375, 'Arcing Slice', { slot: 'Profession_1', weapon_type: 'Greatsword' }),
    war(30851, 'Decapitate', { slot: 'Profession_1', weapon_type: 'Axe', specialization: 18, categories: ['PrimalBurst'] }), war(29852, 'Arc Divider', { slot: 'Profession_1', weapon_type: 'Greatsword', specialization: 18, categories: ['PrimalBurst'] }),
    war(30435, 'Berserk', { slot: 'Profession_2', weapon_type: 'None', specialization: 18, flip_skill: 30185, categories: ['Rage'] }), war(30185, 'Berserk', { slot: 'Profession_2', weapon_type: 'None', specialization: 18, categories: ['Rage'] }),
  ]);
  const wprof = { skills: [{ id: 14418, slot: 'Profession_1' }, { id: 14375, slot: 'Profession_1' }], training: [{ category: 'EliteSpecializations', name: 'Berserker' }] };
  const zerk = S.mechanicsFor({ prof: wprof, profName: 'Warrior', specId: 18, specName: 'Berserker', idx: widx, mainType: 'Axe', offType: 'Axe' });
  assert.deepEqual(zerk.profession.map((s) => s.id), [14418, 30435]); // kjerne-burst og Berserk-skillet (ikke flip-målet)
  assert.deepEqual(zerk.forms.Berserk.profession.map((s) => s.name), ['Decapitate']);
  const coreWar = S.mechanicsFor({ prof: wprof, profName: 'Warrior', specId: 0, specName: '', idx: widx, mainType: 'Greatsword', offType: '' });
  assert.deepEqual(coreWar.profession.map((s) => s.name), ['Arcing Slice']);
  assert.deepEqual(coreWar.forms, {});
});

test('mechanicsFor: Engineer toolbelt fyller F1–F5, elite-spec overstyrer slot, elite-transformasjon blir form', () => {
  const eng = (id, name, extra) => raw(id, name, { professions: ['Engineer'], ...extra });
  const idx = makeIndex([
    eng(1, 'Regenerating Mist', { type: 'Toolbelt', slot: 'Toolbelt' }), eng(2, 'Grenade Barrage', { type: 'Toolbelt', slot: 'Toolbelt' }), eng(5, 'Orbital Strike', { type: 'Toolbelt', slot: 'Toolbelt' }),
    eng(42938, 'Engage Photon Forge', { type: 'Profession', slot: 'Profession_5', weapon_type: 'None', specialization: 57, flip_skill: 41123 }), eng(41123, 'Deactivate Photon Forge', { type: 'Profession', slot: 'Profession_5', weapon_type: 'None', specialization: 57 }),
    eng(5832, 'Elixir X', { type: 'Elite', slot: 'Elite', transform_skills: [5752, 5753, 5754] }), eng(5752, 'Electrified Tornado', { type: 'Bundle', slot: 'Weapon_1' }), eng(5753, 'Dust Tornado', { type: 'Bundle', slot: 'Weapon_2' }), eng(5754, 'Debris Tornado', { type: 'Bundle', slot: 'Weapon_3' }),
  ]);
  const prof = { skills: [], training: [{ category: 'EliteSpecializations', name: 'Holosmith' }] };
  const toolbelt = [idx.byId[1], idx.byId[2], null, null, idx.byId[5]];
  const holo = S.mechanicsFor({ prof, profName: 'Engineer', specId: 57, specName: 'Holosmith', idx, mainType: 'Sword', offType: 'Shield', elite: idx.byId[5832], toolbelt });
  assert.deepEqual(holo.profession.map((s) => s.slot + ':' + s.name), ['Profession_1:Regenerating Mist', 'Profession_2:Grenade Barrage', 'Profession_5:Engage Photon Forge']);
  assert.deepEqual(holo.forms['Elixir X'].weapon.map((s) => s && s.name), ['Electrified Tornado', 'Dust Tornado', 'Debris Tornado', null, null]);
  const core = S.mechanicsFor({ prof, profName: 'Engineer', specId: 0, specName: '', idx, mainType: 'Rifle', offType: '', toolbelt });
  assert.deepEqual(core.profession.map((s) => s.slot + ':' + s.name), ['Profession_1:Regenerating Mist', 'Profession_2:Grenade Barrage', 'Profession_5:Orbital Strike']);
});

test('slotSkills: flip-mål hoppes over, landversjon foretrekkes, ellers siste i lista', () => {
  const idx = makeIndex([
    raw(1, 'A vann', { slot: 'Weapon_1' }), raw(2, 'A land', { slot: 'Weapon_1', flags: ['NoUnderwater'] }),
    raw(3, 'B', { slot: 'Weapon_2', flip_skill: 4 }), raw(4, 'B2', { slot: 'Weapon_2' }),
    raw(5, 'C vann', { slot: 'Weapon_3' }), raw(6, 'C land', { slot: 'Weapon_3' }),
    raw(7, 'D', { slot: 'Utility' }),
  ]);
  assert.deepEqual(S.slotSkills([1, 2, 3, 4, 5, 6, 7], idx).map((s) => s && s.name), ['A land', 'B', 'C land', null, null]);
  assert.deepEqual(S.slotSkills([2, 1], idx).map((s) => s && s.name), ['A land', null, null, null, null]);
  assert.deepEqual(S.slotSkills([3, 4], idx, (s) => s.id === 4).map((s) => s && s.name), [null, 'B2', null, null, null]);
});
