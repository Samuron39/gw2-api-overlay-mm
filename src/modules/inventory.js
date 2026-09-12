'use strict';
// Inventory-modul (hovedprosess): henter, grupperer og kjører regelmotoren. AI-kall går også her.
const gw2 = require('../gw2');
const rules = require('../rules');
const ai = require('../ai');
const { t } = require('../i18n');

const SALVAGE_MATERIAL_IDS = [19721, 19718, 19739, 19741, 19743, 19748, 19745, 19719, 19728, 19730, 19731, 19729, 19732, 19697, 19699, 19702, 19700, 19701, 19723, 19726, 19727, 19724, 19722, 19725];

let lastData = null;

async function refresh(config, demo) {
  if (!config.apiKey && !demo) throw new Error(t('inventory.noApiKey'));
  const acc = demo ? gw2.demoAccountData() : await gw2.fetchAccountData(config.apiKey);
  const ids = [...new Set(acc.instances.map((i) => i.itemId))];
  const [items, materialCats] = await Promise.all([gw2.fetchItems(ids), gw2.fetchMaterialCategories()]);
  const materialIds = new Set(materialCats.flatMap((c) => c.items));
  const prices = await gw2.fetchPrices([...new Set([...ids, ...SALVAGE_MATERIAL_IDS])]);

  const groups = new Map();
  for (const inst of acc.instances) {
    const item = items.get(inst.itemId);
    if (!item) continue;
    const key = `${inst.itemId}|${inst.binding || ''}|${inst.sourceType === 'materials' ? 'm' : 'i'}`;
    let g = groups.get(key);
    if (!g) { g = { item, count: 0, binding: inst.binding, sourceType: inst.sourceType, locations: new Map() }; groups.set(key, g); }
    g.count += inst.count;
    g.locations.set(inst.source, (g.locations.get(inst.source) || 0) + inst.count);
  }

  // Samlingsindeks (alle achievements med item-bits), bare når nøkkelen har progression
  let achIndex = null;
  if (acc.accountAchievements) {
    try { achIndex = await gw2.fetchAchievementIndex(); }
    catch (e) { acc.errors.push(t('inventory.collectionIndex', { message: e.message })); }
  }
  // Items du allerede har ute for salg (krever tradingpost-tillatelse)
  let listed = new Set();
  if (!demo && acc.perms?.includes('tradingpost')) {
    try { listed = new Set((await require('./tp').fetchTp(config.apiKey)).listedItemIds); } catch { /* valgfritt */ }
  }
  const ctx = {
    prices, materialIds, materialCounts: acc.materialCounts,
    keepList: config.keepList, materialCap: config.materialCap, minTp: config.minTp,
    unlocks: acc.unlocks, accountAch: acc.accountAchievements, achIndex, listed,
  };
  const rows = [];
  for (const g of groups.values()) {
    const rec = rules.recommend(g, ctx);
    rows.push({
      id: g.item.id, name: g.item.name, icon: g.item.icon, rarity: g.item.rarity, type: g.item.type, level: g.item.level,
      chatLink: g.item.chat_link, count: g.count, binding: g.binding,
      locations: [...g.locations].map(([source, count]) => ({ source, count })),
      ...rec,
    });
  }
  rows.sort((a, b) => b.totalValue - a.totalValue);
  lastData = { account: acc.account, wallet: acc.wallet, freeSlots: acc.freeSlots, errors: acc.errors, rows, fetchedAt: Date.now() };
  return lastData;
}

function requireData() { if (!lastData) throw new Error(t('inventory.fetchFirst')); return lastData; }

module.exports = {
  refresh,
  get lastData() { return lastData; },
  prioritize: (config, opts) => ai.prioritize(config, requireData(), opts),
  chat: (config, history, opts) => ai.chat(config, requireData(), history, opts),
};
