'use strict';
// Regelmotor: gir én anbefaling per item basert på vendorverdi, TP-pris,
// estimert salvage-verdi, binding, materiallager og behold-liste.

const ECTO_ID = 19721;
const TP_FEE = 0.85; // 5 % listing + 10 % salg

// Basismaterialer per nivåtrinn (T1..T6) brukt til å anslå salvage-verdi.
const TIER = {
  cloth:   [19718, 19739, 19741, 19743, 19748, 19745],
  leather: [19719, 19728, 19730, 19731, 19729, 19732],
  metal:   [19697, 19699, 19699, 19702, 19700, 19701],
  wood:    [19723, 19726, 19727, 19724, 19722, 19725],
};

const ACTION_LABEL = {
  tp: 'Selg på TP',
  vendor: 'Selg til vendor',
  salvage: 'Salvage',
  deposit: 'Deposit',
  keep: 'Behold',
  open: 'Åpne',
  use: 'Bruk',
  stored: 'I lager',
};

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
  const t = tierFor(lvl);
  let matIds;
  if (item.type === 'Armor') {
    const w = item.details?.weight_class;
    matIds = w === 'Heavy' ? [TIER.metal[t]] : w === 'Medium' ? [TIER.leather[t]] : [TIER.cloth[t]];
  } else {
    matIds = [TIER.metal[t], TIER.wood[t]];
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
    if (item.type === 'MiniPet' && item.details?.minipet_id != null && un.minis) { f.unlockDup = un.minis.has(item.details.minipet_id); f.unlockName = 'minien'; }
    if (item.type === 'Consumable' && item.details?.type === 'Unlock') {
      const d = item.details;
      const map = { Dye: ['dyes', d.color_id, 'fargen'], CraftingRecipe: ['recipes', d.recipe_id, 'oppskriften'], Minipet: ['minis', d.minipet_id, 'minien'] };
      const e = map[d.unlock_type];
      if (e && e[1] != null && un[e[0]]) { f.unlockDup = un[e[0]].has(e[1]); f.unlockName = e[2]; }
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
      return done('tp', `Over ${ctx.materialCap} i lager, overskuddet (${count - ctx.materialCap}) kan selges`, tpList, count - ctx.materialCap);
    }
    return done('stored', 'Ligger i materiallageret');
  }

  // 2. Materialer med plass i lageret deponeres alltid, det er aldri feil
  if (isMaterial) {
    const stored = ctx.materialCounts.get(item.id) || 0;
    if (stored < ctx.materialCap) return done('deposit', `Plass i materiallageret (${stored}/${ctx.materialCap})`, 0);
    // lageret er fullt, fall gjennom til behold/salgslogikk
  }

  // 2b. Samlinger: itemet teller i en samling som ikke er registrert
  if (missingColl.length) {
    const names = missingColl.slice(0, 2).map((c) => `«${c.name}»`).join(' og ');
    return done('use', `Teller i samlingen ${names}, ikke registrert ennå. Bruk eller utrust den`);
  }
  // 2c. Opplåsninger (farger, oppskrifter, minis)
  if (facts.unlockDup === false) return done('use', `Låser opp ${facts.unlockName}, som du mangler`);

  // 3. Behold-liste og toppgear
  if (keepHit) return done('keep', `På behold-lista ("${keepHit}")`);
  const isEquipment = ['Armor', 'Weapon', 'Trinket', 'Back', 'UpgradeComponent'].includes(item.type);
  if (item.rarity === 'Legendary') return done('keep', 'Legendary beholdes');
  if (item.rarity === 'Ascended' && isEquipment) return done('keep', 'Ascended-utstyr beholdes');

  // 4. Uidentifisert gear (er teknisk en beholder, så sjekkes først)
  if (lname.includes('unidentified gear')) {
    const ecto = (ctx.prices.get(ECTO_ID)?.buys?.unit_price) || 0;
    if (item.rarity === 'Rare') {
      const ectoEst = Math.max(0, Math.round(ecto * 0.875 - 40));
      if (tpList > ectoEst) return done('tp', `TP (${tpList}c) slår ecto-verdien ved salvage (~${ectoEst}c)`, tpList);
      return done('salvage', `Identifiser og salvage for ecto (~${ectoEst}c/stk, TP gir ${tpList}c)`, ectoEst);
    }
    const t = tierFor(80);
    const matEst = Math.round(((ctx.prices.get(TIER.cloth[t])?.buys?.unit_price || 0) + (ctx.prices.get(TIER.leather[t])?.buys?.unit_price || 0) + (ctx.prices.get(TIER.metal[t])?.buys?.unit_price || 0)) / 3 * 1.8);
    if (tpList > matEst * 1.2) return done('tp', `TP (${tpList}c) slår salvage-verdien (~${matEst}c)`, tpList);
    return done('salvage', `Salvage direkte med copper-fed kit, ~${matEst}c i materialer pluss luck`, Math.max(matEst, vendor));
  }

  // 5. Beholdere
  if (item.type === 'Container') {
    if (tpList * count >= ctx.minTp && tpList > vendor * 2) return done('tp', 'Uåpnet beholder som er verdt mer på TP enn innholdet vanligvis er', tpList);
    return done('open', 'Åpne beholderen og vurder innholdet');
  }

  // 6. Forbruksvarer
  if (item.type === 'Consumable') {
    if (facts.unlockDup === true) {
      if (tpList > 0) return done('tp', `Du har allerede ${facts.unlockName}, selg duplikatet`, tpList);
      if (vendor > 0) return done('vendor', `Du har allerede ${facts.unlockName}, vendor`, vendor);
      return done('keep', `Du har allerede ${facts.unlockName}. Kan ikke selges, ødelegg eller gi bort`);
    }
    if (tpList * count >= ctx.minTp && tpList > vendor) return done('tp', 'Forbruksvare med god TP-pris', tpList);
    return done('use', binding ? 'Bundet forbruksvare, bruk den' : 'Forbruksvare, bruk den eller vendor', vendor);
  }

  // 7. Verktøy, poser, minis, moduler osv.
  if (['Bag', 'Gathering', 'Tool', 'Gizmo', 'Trait', 'MiniPet', 'Key', 'JadeTechModule', 'PowerCore', 'Relic'].includes(item.type)) {
    if (tpList * count >= ctx.minTp && tpList > vendor) return done('tp', 'Selges på TP', tpList);
    if (item.type === 'MiniPet') return facts.unlockDup === true ? done(vendor > 0 ? 'vendor' : 'keep', 'Du har allerede minien', vendor) : done('use', 'Lås opp minien', 0);
    return done('keep', 'Verktøy eller utstyr, behold', 0);
  }

  // 8. Alt annet: velg høyeste av TP, vendor og salvage
  const tpWorth = tpList > 0 && (tpList * count >= ctx.minTp || tpList >= vendor * 2);
  const candidates = [
    { action: 'tp', value: tpWorth ? tpList : 0 },
    { action: 'vendor', value: vendor },
    { action: 'salvage', value: salvage },
  ].filter((c) => c.value > 0).sort((a, b) => b.value - a.value);

  if (!candidates.length) {
    if (tpList > 0) return done('tp', 'Lav verdi, men kan selges på TP', tpList);
    return done('keep', 'Kan verken selges eller salvages, behold eller ødelegg');
  }

  let best = candidates[0];
  const second = candidates[1];
  let reason;
  if (facts.skinLocked === true) {
    const canSalvage = !flags_.includes('NoSalvage') && ['Armor', 'Weapon', 'Back'].includes(item.type);
    if (best.action !== 'tp' || best.value < 10000) {
      if (canSalvage) return done('salvage', `Skinnet er ikke låst opp. Salvage låser det opp gratis (${best.action} gir bare ${best.value}c)`, salvage || best.value);
      return done('use', 'Skinnet er ikke låst opp og itemet kan ikke salvages. Utrust det for å låse opp');
    }
  }
  if (best.action === 'tp') reason = `TP gir mest (${second ? second.action + ' er lavere' : 'ingen alternativ'})`;
  else if (best.action === 'vendor') reason = second ? `Vendor slår ${second.action}` : 'Bare vendor gir verdi';
  else reason = `Salvage (est.) gir mest${second ? ', ' + second.action + ' er lavere' : ''}`;
  if (second && best.value < second.value * 1.1) reason += '. Nesten likt, ta det raskeste';
  if (item.rarity === 'Rare' && (item.level || 0) >= 68 && best.action !== 'salvage') {
    reason += `. Salvage gir ~${salvage}c i ecto`;
  }
  if (facts.skinLocked === true) reason += '. Skinnet er ikke låst opp, salvage hvis du vil ha det';
  if (ctx.listed?.has(item.id)) reason += '. Du har allerede dette ute for salg';
  return done(best.action, reason, best.value);
}

module.exports = { recommend, ACTION_LABEL, salvageEstimate, accountFacts };
