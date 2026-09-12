'use strict';
// Regelmotor: gir én anbefaling per item basert på vendorverdi, TP-pris,
// estimert salvage-verdi, binding, materiallager og behold-liste. Tekstene (label og reason) hentes fra språkfila.
const { t } = require('./i18n');

const ECTO_ID = 19721;
const TP_FEE = 0.85; // 5 % listing + 10 % salg

// Basismaterialer per nivåtrinn (T1..T6) brukt til å anslå salvage-verdi.
const TIER = {
  cloth:   [19718, 19739, 19741, 19743, 19748, 19745],
  leather: [19719, 19728, 19730, 19731, 19729, 19732],
  metal:   [19697, 19699, 19699, 19702, 19700, 19701],
  wood:    [19723, 19726, 19727, 19724, 19722, 19725],
};

// Etikett per anbefaling på valgt språk. Gettere, så ACTION_LABEL.keep alltid gir gjeldende språk.
const ACTIONS = ['tp', 'vendor', 'salvage', 'deposit', 'keep', 'open', 'use', 'stored'];
const ACTION_LABEL = {};
for (const a of ACTIONS) Object.defineProperty(ACTION_LABEL, a, { get: () => t('rules.action.' + a), enumerable: true });

function tierFor(level) {
  if (level <= 15) return 0;
  if (level <= 30) return 1;
  if (level <= 45) return 2;
  if (level <= 60) return 3;
  if (level <= 75) return 4;
  return 5;
}

function salvageEstimate(item, prices) {
  const flags = item.flags || [];
  if (flags.includes('NoSalvage')) return 0;
  if (!['Armor', 'Weapon', 'Trinket', 'Back'].includes(item.type)) return 0;
  const buy = (id) => (prices.get(id)?.buys?.unit_price) || 0;
  const r = item.rarity;
  const lvl = item.level || 0;
  if (r === 'Ascended' || r === 'Legendary') return 0;
  if ((r === 'Exotic' || r === 'Rare') && lvl >= 68) {
    // Ecto-sjanse: ca 0.875 med master kit, ca 1.15 for exotic med BL-kit
    const ectos = r === 'Exotic' ? 1.15 : 0.875;
    return Math.max(0, Math.round(buy(ECTO_ID) * ectos - 40));
  }
  if (item.type === 'Trinket' || item.type === 'Back') return 0;
  const tier = tierFor(lvl);
  let matIds;
  if (item.type === 'Armor') {
    const w = item.details?.weight_class;
    matIds = w === 'Heavy' ? [TIER.metal[tier]] : w === 'Medium' ? [TIER.leather[tier]] : [TIER.cloth[tier]];
  } else {
    matIds = [TIER.metal[tier], TIER.wood[tier]];
  }
  const avg = matIds.reduce((s, id) => s + buy(id), 0) / matIds.length;
  const luck = r === 'Masterwork' ? 8 : r === 'Fine' ? 3 : 0;
  return Math.round(avg * 1.8 + luck);
}

// Hva kontoen vet om itemet: samlinger det inngår i, om skinnet er låst opp, om opplåsningen allerede er eid.
function accountFacts(item, ctx) {
  const f = { collections: [], skinLocked: null, unlockDup: null, unlockName: '' };
  const idx = ctx.achIndex, acc = ctx.accountAch, un = ctx.unlocks;
  if (idx && acc) {
    const refs = [...(idx.items[item.id] || [])];
    if (item.default_skin && idx.skins[item.default_skin]) refs.push(...idx.skins[item.default_skin]);
    const miniId = item.details?.minipet_id;
    if (item.type === 'MiniPet' && miniId != null && idx.minis[miniId]) refs.push(...idx.minis[miniId]);
    const seen = new Set();
    for (const r of refs) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const a = acc.get(r.id);
      f.collections.push({ id: r.id, name: r.name, has: !!a && (a.done || a.bits.has(r.bit)) });
    }
  }
  if (un && un.available) {
    if (item.default_skin && ['Armor', 'Weapon', 'Back'].includes(item.type) && un.skins) f.skinLocked = !un.skins.has(item.default_skin);
    if (item.type === 'MiniPet' && item.details?.minipet_id != null && un.minis) { f.unlockDup = un.minis.has(item.details.minipet_id); f.unlockName = t('rules.unlock.mini'); }
    if (item.type === 'Consumable' && item.details?.type === 'Unlock') {
      const d = item.details;
      const map = { Dye: ['dyes', d.color_id, 'rules.unlock.dye'], CraftingRecipe: ['recipes', d.recipe_id, 'rules.unlock.recipe'], Minipet: ['minis', d.minipet_id, 'rules.unlock.mini'] };
      const e = map[d.unlock_type];
      if (e && e[1] != null && un[e[0]]) { f.unlockDup = un[e[0]].has(e[1]); f.unlockName = t(e[2]); }
    }
  }
  return f;
}

/**
 * row: { item, count, binding, sourceType }
 * ctx: { prices: Map, materialIds: Set, materialCounts: Map, keepList: string[], materialCap, minTp }
 */
function recommend(row, ctx) {
  const { item, count, binding, sourceType } = row;
  const flags_ = item.flags || [];
  const p = ctx.prices.get(item.id);
  const vendor = flags_.includes('NoSell') ? 0 : (item.vendor_value || 0);
  const tpAllowed = !binding && !flags_.includes('AccountBound') && !flags_.includes('SoulbindOnAcquire') && !!p;
  const tpList = tpAllowed && p?.sells?.unit_price ? Math.floor((p.sells.unit_price - 1) * TP_FEE) : 0;
  const tpInstant = tpAllowed && p?.buys?.unit_price ? Math.floor(p.buys.unit_price * TP_FEE) : 0;
  const salvage = salvageEstimate(item, ctx.prices);
  const lname = (item.name || '').toLowerCase();
  const keepHit = ctx.keepList.find((k) => k && lname.includes(k.toLowerCase()));
  const isMaterial = ctx.materialIds.has(item.id);
  const values = { vendor, tpList, tpInstant, salvage };

  const facts = accountFacts(item, ctx);
  const flags = [];
  const missingColl = facts.collections.filter((c) => !c.has);
  if (missingColl.length) flags.push('collection');
  if (facts.skinLocked === true) flags.push('skinLocked');
  if (facts.unlockDup === true) flags.push('unlockDup');
  if (facts.unlockDup === false) flags.push('unlockNew');
  if (ctx.listed?.has(item.id)) flags.push('listed');
  const done = (action, reason, unitValue = 0, units = count) => ({
    action, label: ACTION_LABEL[action], reason, unitValue, totalValue: unitValue * units, ...values,
    flags, collections: facts.collections,
  });

  // 1. Materiallager
  if (sourceType === 'materials') {
    if (count > ctx.materialCap && tpList >= ctx.minTp) {
      return done('tp', t('rules.reason.materialsOver', { cap: ctx.materialCap, excess: count - ctx.materialCap }), tpList, count - ctx.materialCap);
    }
    return done('stored', t('rules.reason.stored'));
  }

  // 2. Materialer med plass i lageret deponeres alltid, det er aldri feil
  if (isMaterial) {
    const stored = ctx.materialCounts.get(item.id) || 0;
    if (stored < ctx.materialCap) return done('deposit', t('rules.reason.depositRoom', { stored, cap: ctx.materialCap }), 0);
    // lageret er fullt, fall gjennom til behold/salgslogikk
  }

  // 2b. Samlinger: itemet teller i en samling som ikke er registrert
  if (missingColl.length) {
    const names = missingColl.slice(0, 2).map((c) => `«${c.name}»`).join(' ' + t('common.and') + ' ');
    return done('use', t('rules.reason.collection', { names }));
  }
  // 2c. Opplåsninger (farger, oppskrifter, minis)
  if (facts.unlockDup === false) return done('use', t('rules.reason.unlockNew', { what: facts.unlockName }));

  // 3. Behold-liste og toppgear
  if (keepHit) return done('keep', t('rules.reason.keepList', { hit: keepHit }));
  const isEquipment = ['Armor', 'Weapon', 'Trinket', 'Back', 'UpgradeComponent'].includes(item.type);
  if (item.rarity === 'Legendary') return done('keep', t('rules.reason.legendary'));
  if (item.rarity === 'Ascended' && isEquipment) return done('keep', t('rules.reason.ascended'));

  // 4. Uidentifisert gear (er teknisk en beholder, så sjekkes først)
  if (lname.includes('unidentified gear')) {
    const ecto = (ctx.prices.get(ECTO_ID)?.buys?.unit_price) || 0;
    if (item.rarity === 'Rare') {
      const ectoEst = Math.max(0, Math.round(ecto * 0.875 - 40));
      if (tpList > ectoEst) return done('tp', t('rules.reason.unidRareTp', { tp: tpList, ecto: ectoEst }), tpList);
      return done('salvage', t('rules.reason.unidRareSalvage', { tp: tpList, ecto: ectoEst }), ectoEst);
    }
    const tier = tierFor(80);
    const matEst = Math.round(((ctx.prices.get(TIER.cloth[tier])?.buys?.unit_price || 0) + (ctx.prices.get(TIER.leather[tier])?.buys?.unit_price || 0) + (ctx.prices.get(TIER.metal[tier])?.buys?.unit_price || 0)) / 3 * 1.8);
    if (tpList > matEst * 1.2) return done('tp', t('rules.reason.unidTp', { tp: tpList, mat: matEst }), tpList);
    return done('salvage', t('rules.reason.unidSalvage', { mat: matEst }), Math.max(matEst, vendor));
  }

  // 5. Beholdere
  if (item.type === 'Container') {
    if (tpList * count >= ctx.minTp && tpList > vendor * 2) return done('tp', t('rules.reason.containerTp'), tpList);
    return done('open', t('rules.reason.containerOpen'));
  }

  // 6. Forbruksvarer
  if (item.type === 'Consumable') {
    if (facts.unlockDup === true) {
      if (tpList > 0) return done('tp', t('rules.reason.dupTp', { what: facts.unlockName }), tpList);
      if (vendor > 0) return done('vendor', t('rules.reason.dupVendor', { what: facts.unlockName }), vendor);
      return done('keep', t('rules.reason.dupKeep', { what: facts.unlockName }));
    }
    if (tpList * count >= ctx.minTp && tpList > vendor) return done('tp', t('rules.reason.consumableTp'), tpList);
    return done('use', t(binding ? 'rules.reason.consumableBound' : 'rules.reason.consumableUse'), vendor);
  }

  // 7. Verktøy, poser, minis, moduler osv.
  if (['Bag', 'Gathering', 'Tool', 'Gizmo', 'Trait', 'MiniPet', 'Key', 'JadeTechModule', 'PowerCore', 'Relic'].includes(item.type)) {
    if (tpList * count >= ctx.minTp && tpList > vendor) return done('tp', t('rules.reason.toolTp'), tpList);
    if (item.type === 'MiniPet') return facts.unlockDup === true ? done(vendor > 0 ? 'vendor' : 'keep', t('rules.reason.miniDup'), vendor) : done('use', t('rules.reason.miniUse'), 0);
    return done('keep', t('rules.reason.toolKeep'), 0);
  }

  // 8. Alt annet: velg høyeste av TP, vendor og salvage
  const tpWorth = tpList > 0 && (tpList * count >= ctx.minTp || tpList >= vendor * 2);
  const candidates = [
    { action: 'tp', value: tpWorth ? tpList : 0 },
    { action: 'vendor', value: vendor },
    { action: 'salvage', value: salvage },
  ].filter((c) => c.value > 0).sort((a, b) => b.value - a.value);

  if (!candidates.length) {
    if (tpList > 0) return done('tp', t('rules.reason.lowTp'), tpList);
    return done('keep', t('rules.reason.nothing'));
  }

  let best = candidates[0];
  const second = candidates[1];
  let reason;
  if (facts.skinLocked === true) {
    const canSalvage = !flags_.includes('NoSalvage') && ['Armor', 'Weapon', 'Back'].includes(item.type);
    if (best.action !== 'tp' || best.value < 10000) {
      if (canSalvage) return done('salvage', t('rules.reason.skinSalvage', { action: best.action, value: best.value }), salvage || best.value);
      return done('use', t('rules.reason.skinUse'));
    }
  }
  if (best.action === 'tp') reason = t('rules.reason.tpBest', { alt: second ? t('rules.reason.tpAlt', { action: second.action }) : t('rules.reason.tpNoAlt') });
  else if (best.action === 'vendor') reason = second ? t('rules.reason.vendorBest', { action: second.action }) : t('rules.reason.vendorOnly');
  else reason = t('rules.reason.salvageBest') + (second ? t('rules.reason.salvageAlt', { action: second.action }) : '');
  if (second && best.value < second.value * 1.1) reason += t('rules.reason.close');
  if (item.rarity === 'Rare' && (item.level || 0) >= 68 && best.action !== 'salvage') {
    reason += t('rules.reason.ectoNote', { c: salvage });
  }
  if (facts.skinLocked === true) reason += t('rules.reason.skinNote');
  if (ctx.listed?.has(item.id)) reason += t('rules.reason.listedNote');
  return done(best.action, reason, best.value);
}

module.exports = { recommend, ACTION_LABEL, salvageEstimate, accountFacts };
