'use strict';
// Karakter-modul (hovedprosess): utstyr, crafting, mangler og AI-vurdering.
const gw2 = require('../gw2');
const ai = require('../ai');
const { t } = require('../i18n');

let cache = { at: 0, key: '', data: null };
const PVE_SLOTS = ['Helm', 'Shoulders', 'Coat', 'Gloves', 'Leggings', 'Boots', 'Backpack', 'Accessory1', 'Accessory2', 'Amulet', 'Ring1', 'Ring2', 'WeaponA1', 'WeaponB1'];
const RARITY_RANK = { Junk: 0, Basic: 1, Fine: 2, Masterwork: 3, Rare: 4, Exotic: 5, Ascended: 6, Legendary: 7 };

async function fetchCharacters(key) {
  if (!key) throw new Error(t('common.noApiKeyShort'));
  if (cache.data && cache.key === key && Date.now() - cache.at < 120e3) return cache.data;
  const chars = await gw2.get('/characters', { key, params: { ids: 'all' } });
  const itemIds = new Set();
  for (const c of chars) for (const e of c.equipment || []) { itemIds.add(e.id); (e.upgrades || []).forEach((u) => itemIds.add(u)); (e.infusions || []).forEach((u) => itemIds.add(u)); }
  const items = await gw2.fetchItems([...itemIds]);
  const statNames = new Map();
  const statIds = new Set();
  for (const c of chars) for (const e of c.equipment || []) { const it = items.get(e.id); const sid = e.stats?.id ?? it?.details?.infix_upgrade?.id; if (sid) statIds.add(sid); }
  if (statIds.size) {
    try { const stats = await gw2.get('/itemstats', { params: { ids: [...statIds].join(',') }, bulk: true }); for (const s of stats) statNames.set(s.id, s.name); } catch { /* valgfritt */ }
  }

  const out = chars.map((c) => {
    const eq = (c.equipment || []).filter((e) => !e.tabs || e.tabs.length === 0 || true);
    const bySlot = new Map();
    for (const e of eq) if (!bySlot.has(e.slot)) bySlot.set(e.slot, e);
    const rows = [];
    const issues = [];
    for (const slot of PVE_SLOTS) {
      const e = bySlot.get(slot);
      if (!e) { if (c.level >= 80 && slot !== 'WeaponB1' && slot !== 'Backpack') issues.push(t('characters.issue.emptySlot', { slot })); continue; }
      const it = items.get(e.id) || {};
      const upgrades = (e.upgrades || []).map((u) => items.get(u)?.name || `#${u}`);
      const infusions = (e.infusions || []).map((u) => items.get(u)?.name || `#${u}`);
      const stat = statNames.get(e.stats?.id ?? it.details?.infix_upgrade?.id) || '';
      const isArmorOrWeapon = ['Armor', 'Weapon'].includes(it.type);
      const isTrinket = ['Trinket', 'Back'].includes(it.type);
      const upgradeSlots = it.details?.infusion_slots?.length ?? 0;
      if (c.level >= 80) {
        if (isArmorOrWeapon && upgrades.length === 0) issues.push(t('characters.issue.missingUpgrade', { slot, what: t(it.type === 'Weapon' ? 'characters.sigil' : 'characters.rune') }));
        if ((RARITY_RANK[it.rarity] ?? 0) < RARITY_RANK.Exotic && (isArmorOrWeapon || isTrinket)) issues.push(t('characters.issue.belowExotic', { slot, rarity: it.rarity || t('characters.unknown') }));
        if (it.rarity === 'Ascended' && upgradeSlots > infusions.length && it.type !== 'Weapon') issues.push(t('characters.issue.emptyInfusion', { slot, n: upgradeSlots - infusions.length }));
      }
      rows.push({ slot, id: e.id, name: it.name || t('common.itemId', { id: e.id }), icon: it.icon, rarity: it.rarity, type: it.type, level: it.level, stat, upgrades, infusions, binding: e.binding || '' });
    }
    return {
      name: c.name, race: c.race, gender: c.gender, profession: c.profession, level: c.level, age: c.age, deaths: c.deaths, created: c.created, title: c.title,
      crafting: (c.crafting || []).map((x) => ({ discipline: x.discipline, rating: x.rating, active: x.active })),
      equipment: rows, issues,
    };
  }).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  const data = { fetchedAt: Date.now(), characters: out };
  cache = { at: Date.now(), key, data };
  return data;
}

function findLatestLogFor(charName, dpsModule, dir) {
  try {
    for (const l of dpsModule.listLogs(dir, 30)) {
      try { const r = dpsModule.parseLog(l.file); const me = r.players.find((p) => p.name === charName); if (me) return { boss: r.boss, durationMs: r.durationMs, me, top: r.players[0] }; } catch { /* hopp over */ }
    }
  } catch { /* ingen logger */ }
  return null;
}

async function review(config, charName, dpsModule, dir) {
  const data = await fetchCharacters(config.apiKey);
  const c = data.characters.find((x) => x.name === charName);
  if (!c) throw new Error(t('characters.notFound'));
  const log = findLatestLogFor(charName, dpsModule, dir);
  const lines = [
    `Karakter: ${c.name}, ${c.race} ${c.profession} level ${c.level}.`,
    'Utstyr (slot: item, rarity, stat-kombinasjon, oppgraderinger):',
    ...c.equipment.map((e) => `- ${e.slot}: ${e.name} [${e.rarity}${e.stat ? ', ' + e.stat : ''}]${e.upgrades.length ? ' + ' + e.upgrades.join(', ') : ''}${e.infusions.length ? ' | infusions: ' + e.infusions.join(', ') : ''}`),
    c.issues.length ? 'Automatisk funnet: ' + c.issues.join('; ') : 'Ingen åpenbare hull i utstyret.',
  ];
  if (log) lines.push(`Siste ArcDPS-logg med denne karakteren: ${log.boss}, ${Math.round(log.durationMs / 1000)}s. Egen DPS mot boss: ${log.me.dpsTarget} (${log.me.spec}). Beste i gruppa: ${log.top.name} ${log.top.dpsTarget} (${log.top.spec}).`);
  const messages = [
    { role: 'system', content: `Du er en erfaren Guild Wars 2-spiller og build-rådgiver. Svar på ${ai.answerLanguage()}, kort og konkret, i punktlister. Ikke finn opp stat-navn eller runer som ikke finnes.` },
    { role: 'user', content: lines.join('\n') + '\n\nVurder utstyret: hva trekker mest ned, hva bør byttes først, og passer stat-kombinasjonen til profesjonen? Hvis DPS-logg finnes, kommenter forskjellen til beste i gruppa.' },
  ];
  return ai.completeText(config, messages);
}

module.exports = { fetchCharacters, review, invalidate: () => { cache.at = 0; } };
