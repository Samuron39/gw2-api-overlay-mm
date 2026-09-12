'use strict';
// Tester for regelmotoren i src/rules.js: én anbefaling per item ut fra syntetiske items, priser og kontofakta.
const test = require('node:test');
const assert = require('node:assert/strict');
const { recommend, ACTION_LABEL, salvageEstimate } = require('../src/rules');

const ECTO_ID = 19721;
// T6-materialer som brukes til å anslå verdien av vanlig uidentifisert gear (se TIER i rules.js)
const T6 = { cloth: 19745, leather: 19732, metal: 19701 };
// T2-materialer (level 16–30)
const T2 = { cloth: 19739, leather: 19728, metal: 19699 };

const price = (sells, buys = 0) => ({ sells: { unit_price: sells }, buys: { unit_price: buys } });
const buyOnly = (buys) => ({ sells: { unit_price: 0 }, buys: { unit_price: buys } });

function ctx(over = {}) {
  return {
    prices: new Map(), materialIds: new Set(), materialCounts: new Map(), keepList: [], materialCap: 250, minTp: 100,
    unlocks: { available: true, skins: new Set(), dyes: new Set(), recipes: new Set(), minis: new Set() },
    accountAch: new Map(), achIndex: { items: {}, skins: {}, minis: {} }, listed: new Set(),
    ...over,
  };
}

function item(over = {}) {
  return { id: 1, name: 'Testitem', type: 'Trophy', rarity: 'Fine', level: 0, vendor_value: 0, flags: [], default_skin: 0, details: {}, ...over };
}

const row = (it, over = {}) => ({ item: it, count: 1, binding: null, sourceType: 'character', ...over });

test('etiketter: hver handling har norsk etikett og svaret bruker den', () => {
  for (const a of ['tp', 'vendor', 'salvage', 'deposit', 'keep', 'open', 'use', 'stored']) assert.ok(ACTION_LABEL[a], a);
  const r = recommend(row(item({ type: 'Bag' })), ctx());
  assert.equal(r.action, 'keep');
  assert.equal(r.label, ACTION_LABEL.keep);
});

test('materiallager: deposit går foran behold-lista når det er plass', () => {
  const it = item({ id: 19718, name: 'Jute Scrap', type: 'CraftingMaterial', vendor_value: 3 });
  const c = ctx({ materialIds: new Set([19718]), materialCounts: new Map([[19718, 100]]), keepList: ['jute'], prices: new Map([[19718, price(500, 400)]]) });
  const r = recommend(row(it, { count: 40 }), c);
  assert.equal(r.action, 'deposit');
  assert.equal(r.label, 'Deposit');
  assert.match(r.reason, /100\/250/);
  assert.equal(r.unitValue, 0);
  assert.equal(r.totalValue, 0);
});

test('materiallager fullt: faller gjennom til behold-lista', () => {
  const it = item({ id: 19718, name: 'Jute Scrap', type: 'CraftingMaterial', vendor_value: 3 });
  const c = ctx({ materialIds: new Set([19718]), materialCounts: new Map([[19718, 250]]), keepList: ['jute'] });
  const r = recommend(row(it, { count: 40 }), c);
  assert.equal(r.action, 'keep');
  assert.match(r.reason, /behold-lista/);
});

test('behold-liste: treff på delstreng, uavhengig av store og små bokstaver, slår høy TP-pris', () => {
  const it = item({ id: 19976, name: 'Mystic Coin', type: 'CraftingMaterial' });
  const c = ctx({ keepList: ['', 'MYSTIC'], prices: new Map([[19976, price(20000, 19000)]]) });
  const r = recommend(row(it, { count: 250 }), c);
  assert.equal(r.action, 'keep');
  assert.match(r.reason, /"MYSTIC"/);
  // verdiene regnes likevel ut og følger med
  assert.equal(r.tpList, Math.floor(19999 * 0.85));
  assert.equal(r.tpInstant, Math.floor(19000 * 0.85));
});

test('kilde materials: overskudd over kapasitet selges hvis TP-prisen når terskelen, ellers «I lager»', () => {
  const it = item({ id: 19718, name: 'Jute Scrap', type: 'CraftingMaterial' });
  const c = ctx({ prices: new Map([[19718, price(200, 150)]]) });
  const over = recommend(row(it, { count: 300, sourceType: 'materials' }), c);
  assert.equal(over.action, 'tp');
  assert.equal(over.unitValue, Math.floor(199 * 0.85));
  assert.equal(over.totalValue, over.unitValue * 50, 'bare overskuddet (300 - 250) regnes');
  assert.match(over.reason, /\(50\)/);

  const under = recommend(row(it, { count: 200, sourceType: 'materials' }), c);
  assert.equal(under.action, 'stored');
  assert.equal(under.label, 'I lager');

  const billig = recommend(row(it, { count: 300, sourceType: 'materials' }), ctx({ prices: new Map([[19718, price(50, 40)]]) }));
  assert.equal(billig.action, 'stored', 'TP under minTp gir ikke salg');
});

test('Legendary beholdes uansett type, også med skyhøy TP-pris', () => {
  const c = ctx({ prices: new Map([[7, price(9e7, 8e7)]]) });
  assert.equal(recommend(row(item({ id: 7, type: 'Weapon', rarity: 'Legendary', level: 80 })), c).action, 'keep');
  const gift = recommend(row(item({ id: 7, name: 'Gift of Fortune', type: 'Trophy', rarity: 'Legendary' })), c);
  assert.equal(gift.action, 'keep');
  assert.match(gift.reason, /Legendary/);
});

test('Ascended-utstyr beholdes, men Ascended forbruksvare behandles som forbruksvare', () => {
  const armor = recommend(row(item({ type: 'Armor', rarity: 'Ascended', level: 80, vendor_value: 500 })), ctx());
  assert.equal(armor.action, 'keep');
  assert.match(armor.reason, /Ascended/);
  const trinket = recommend(row(item({ type: 'Trinket', rarity: 'Ascended', level: 80 })), ctx());
  assert.equal(trinket.action, 'keep');
  const mat = recommend(row(item({ type: 'Consumable', rarity: 'Ascended', vendor_value: 50 })), ctx());
  assert.equal(mat.action, 'use');
});

test('samlinger: item som teller i en uferdig samling gir Bruk med samlingens navn', () => {
  const it = item({ id: 555, type: 'Weapon', rarity: 'Exotic', level: 80, vendor_value: 300 });
  const achIndex = { items: { 555: [{ id: 42, name: 'Sjeldne våpen', bit: 3 }] }, skins: {}, minis: {} };
  // bit 3 mangler
  const mangler = recommend(row(it), ctx({ achIndex, accountAch: new Map([[42, { done: false, bits: new Set([1, 2]) }]]) }));
  assert.equal(mangler.action, 'use');
  assert.match(mangler.reason, /«Sjeldne våpen»/);
  assert.ok(mangler.flags.includes('collection'));
  assert.deepEqual(mangler.collections, [{ id: 42, name: 'Sjeldne våpen', has: false }]);
  // achievementet finnes ikke på kontoen i det hele tatt: også mangler
  const ukjent = recommend(row(it), ctx({ achIndex, accountAch: new Map() }));
  assert.equal(ukjent.action, 'use');
  // bit 3 er registrert
  const har = recommend(row(it), ctx({ achIndex, accountAch: new Map([[42, { done: false, bits: new Set([3]) }]]) }));
  assert.notEqual(har.action, 'use');
  assert.ok(!har.flags.includes('collection'));
  assert.equal(har.collections[0].has, true);
  // hele achievementet er ferdig
  const ferdig = recommend(row(it), ctx({ achIndex, accountAch: new Map([[42, { done: true, bits: new Set() }]]) }));
  assert.equal(ferdig.collections[0].has, true);
});

test('samlinger via skinn-indeks og minis, og flere samlinger nevnes med «og»', () => {
  const achIndex = {
    items: { 600: [{ id: 50, name: 'Samling A', bit: 0 }] },
    skins: { 777: [{ id: 51, name: 'Samling B', bit: 1 }, { id: 50, name: 'Samling A', bit: 0 }] },
    minis: { 9: [{ id: 52, name: 'Minisamling', bit: 4 }] },
  };
  const c = ctx({ achIndex, accountAch: new Map() });
  const via = recommend(row(item({ id: 600, type: 'Armor', rarity: 'Exotic', level: 80, default_skin: 777 })), c);
  assert.equal(via.action, 'use');
  assert.match(via.reason, /«Samling A» og «Samling B»/);
  assert.equal(via.collections.length, 2, 'samme achievement telles bare én gang');
  const mini = recommend(row(item({ id: 601, type: 'MiniPet', details: { minipet_id: 9 } })), c);
  assert.equal(mini.action, 'use');
  assert.match(mini.reason, /«Minisamling»/);
});

test('skinn ikke låst opp: salvage anbefales fremfor vendor, og flagget settes', () => {
  const it = item({ id: 800, type: 'Armor', rarity: 'Exotic', level: 80, vendor_value: 300, default_skin: 900, details: { weight_class: 'Heavy' } });
  const låst = recommend(row(it), ctx());
  assert.equal(låst.action, 'salvage');
  assert.ok(låst.flags.includes('skinLocked'));
  assert.match(låst.reason, /Skinnet er ikke låst opp/);
  assert.equal(låst.unitValue, 300, 'uten ecto-pris brukes vendor-verdien som anslag');

  // med ecto-pris er salvage-verdien (1.15 ecto) høyere enn vendor uansett
  const medEcto = recommend(row(it), ctx({ prices: new Map([[ECTO_ID, buyOnly(3000)]]) }));
  assert.equal(medEcto.action, 'salvage');
  assert.equal(medEcto.salvage, Math.round(3000 * 1.15 - 40));
  assert.equal(medEcto.unitValue, medEcto.salvage);

  // skinnet er låst opp: vendor
  const åpen = recommend(row(it), ctx({ unlocks: { available: true, skins: new Set([900]) } }));
  assert.equal(åpen.action, 'vendor');
  assert.ok(!åpen.flags.includes('skinLocked'));

  // ukjent status (unlocks ikke tilgjengelig): ingen skinn-logikk
  const ukjent = recommend(row(it), ctx({ unlocks: { available: false } }));
  assert.equal(ukjent.action, 'vendor');
  assert.ok(!ukjent.flags.includes('skinLocked'));
});

test('skinn ikke låst opp, men TP over 1 gull: selg, med hint om skinnet i begrunnelsen', () => {
  const it = item({ id: 801, type: 'Weapon', rarity: 'Exotic', level: 80, vendor_value: 300, default_skin: 901 });
  const r = recommend(row(it), ctx({ prices: new Map([[801, price(20000, 15000)]]) }));
  assert.equal(r.action, 'tp');
  assert.equal(r.unitValue, Math.floor(19999 * 0.85));
  assert.match(r.reason, /Skinnet er ikke låst opp, salvage hvis du vil ha det/);
});

test('skinn ikke låst opp og NoSalvage: utrust det for å låse opp', () => {
  const it = item({ id: 802, type: 'Back', rarity: 'Exotic', level: 80, vendor_value: 100, default_skin: 902, flags: ['NoSalvage'] });
  const r = recommend(row(it), ctx());
  assert.equal(r.action, 'use');
  assert.match(r.reason, /kan ikke salvages/);
  assert.equal(r.salvage, 0);
});

test('farger: duplikat selges på TP, til vendor eller beholdes, manglende brukes', () => {
  const dye = (id) => item({ id, name: 'Abyss Dye', type: 'Consumable', rarity: 'Rare', details: { type: 'Unlock', unlock_type: 'Dye', color_id: 12 } });
  const har = { available: true, skins: new Set(), dyes: new Set([12]), recipes: new Set(), minis: new Set() };
  const tp = recommend(row(dye(1)), ctx({ unlocks: har, prices: new Map([[1, price(500, 400)]]) }));
  assert.equal(tp.action, 'tp');
  assert.match(tp.reason, /Du har allerede fargen/);
  assert.ok(tp.flags.includes('unlockDup'));
  const vendor = recommend(row(item({ ...dye(2), vendor_value: 8 })), ctx({ unlocks: har }));
  assert.equal(vendor.action, 'vendor');
  assert.equal(vendor.unitValue, 8);
  const keep = recommend(row(dye(3)), ctx({ unlocks: har }));
  assert.equal(keep.action, 'keep');
  assert.match(keep.reason, /ødelegg eller gi bort/);

  const mangler = recommend(row(dye(4)), ctx({ prices: new Map([[4, price(500, 400)]]) }));
  assert.equal(mangler.action, 'use', 'manglende farge brukes selv om TP-prisen er god');
  assert.match(mangler.reason, /Låser opp fargen/);
  assert.ok(mangler.flags.includes('unlockNew'));
});

test('oppskrifter og minis: samme duplikat-logikk med riktig ord', () => {
  const un = { available: true, skins: new Set(), dyes: new Set(), recipes: new Set([5]), minis: new Set([7]) };
  const recipe = item({ id: 10, type: 'Consumable', vendor_value: 4, details: { type: 'Unlock', unlock_type: 'CraftingRecipe', recipe_id: 5 } });
  const r1 = recommend(row(recipe), ctx({ unlocks: un }));
  assert.equal(r1.action, 'vendor');
  assert.match(r1.reason, /oppskriften/);
  const r2 = recommend(row(recipe), ctx());
  assert.equal(r2.action, 'use');
  assert.match(r2.reason, /oppskriften/);

  const mini = item({ id: 11, type: 'MiniPet', vendor_value: 6, details: { minipet_id: 7 } });
  const m1 = recommend(row(mini), ctx({ unlocks: un }));
  assert.equal(m1.action, 'vendor');
  assert.match(m1.reason, /minien/);
  const m2 = recommend(row(mini), ctx());
  assert.equal(m2.action, 'use');
  assert.match(m2.reason, /Låser opp minien/);
  assert.ok(m2.flags.includes('unlockNew'));
  // uten opplåsningsdata: fortsatt Bruk, men uten flagg
  const m4 = recommend(row(mini), ctx({ unlocks: { available: false } }));
  assert.equal(m4.action, 'use');
  assert.match(m4.reason, /Lås opp minien/);
  assert.ok(!m4.flags.includes('unlockNew'));
  const m3 = recommend(row(mini), ctx({ unlocks: un, prices: new Map([[11, price(2000, 1500)]]) }));
  assert.equal(m3.action, 'tp', 'god TP-pris vinner over duplikat-vendor');
});

test('uidentifisert gear (rare): salvage for ecto, med mindre TP slår ecto-anslaget', () => {
  const it = item({ id: 83008, name: 'Piece of Rare Unidentified Gear', type: 'Container', rarity: 'Rare', level: 80 });
  const ectoEst = Math.round(3000 * 0.875 - 40);
  const lav = recommend(row(it, { count: 5 }), ctx({ prices: new Map([[ECTO_ID, buyOnly(3000)], [83008, price(2000, 1800)]]) }));
  assert.equal(lav.action, 'salvage');
  assert.equal(lav.unitValue, ectoEst);
  assert.equal(lav.totalValue, ectoEst * 5);
  assert.match(lav.reason, new RegExp(`~${ectoEst}c`));
  const høy = recommend(row(it), ctx({ prices: new Map([[ECTO_ID, buyOnly(3000)], [83008, price(4000, 3500)]]) }));
  assert.equal(høy.action, 'tp');
  assert.equal(høy.unitValue, Math.floor(3999 * 0.85));
});

test('uidentifisert gear (vanlig): salvage med copper-fed, TP bare hvis 20 % bedre', () => {
  const it = item({ id: 83000, name: 'Piece of Unidentified Gear', type: 'Container', rarity: 'Masterwork', level: 80 });
  const mats = [[T6.cloth, buyOnly(100)], [T6.leather, buyOnly(100)], [T6.metal, buyOnly(100)]];
  const matEst = Math.round(100 * 1.8);
  const salv = recommend(row(it), ctx({ prices: new Map([...mats, [83000, price(200, 150)]]) }));
  assert.equal(salv.action, 'salvage');
  assert.equal(salv.unitValue, matEst);
  assert.match(salv.reason, /copper-fed/);
  const tp = recommend(row(it), ctx({ prices: new Map([...mats, [83000, price(300, 250)]]) }));
  assert.equal(tp.action, 'tp', `${Math.floor(299 * 0.85)}c > ${matEst * 1.2}c`);
  // uten prisdata i det hele tatt: fortsatt salvage, vendor-verdien som gulv
  const tom = recommend(row(item({ ...it, vendor_value: 20 })), ctx());
  assert.equal(tom.action, 'salvage');
  assert.equal(tom.unitValue, 20);
});

test('TP-terskel gjelder per stack: 10 stk når terskelen, 1 stk gjør det ikke', () => {
  const it = item({ id: 20, type: 'Trophy', vendor_value: 15 });
  const c = ctx({ prices: new Map([[20, price(30, 20)]]) });
  const tpList = Math.floor(29 * 0.85); // 24, under minTp 100 og under 2 × vendor
  const en = recommend(row(it, { count: 1 }), c);
  assert.equal(en.action, 'vendor');
  assert.equal(en.tpList, tpList);
  assert.equal(en.totalValue, 15);
  const ti = recommend(row(it, { count: 10 }), c);
  assert.equal(ti.action, 'tp');
  assert.equal(ti.totalValue, tpList * 10);
  // liten stack, men TP minst dobbelt av vendor: TP likevel
  const dobbel = recommend(row(item({ id: 20, type: 'Trophy', vendor_value: 10 })), c);
  assert.equal(dobbel.action, 'tp');
});

test('vendor, salvage eller TP: høyeste anslag vinner, med begrunnelse', () => {
  const armor = (vendor) => item({ id: 30, type: 'Armor', rarity: 'Fine', level: 20, vendor_value: vendor, details: { weight_class: 'Light' } });
  const salvageVal = Math.round(50 * 1.8 + 3); // T2 cloth til 50c, Fine gir +3 luck
  const s = recommend(row(armor(30)), ctx({ prices: new Map([[T2.cloth, buyOnly(50)]]) }));
  assert.equal(s.action, 'salvage');
  assert.equal(s.salvage, salvageVal);
  assert.equal(s.unitValue, salvageVal);
  assert.match(s.reason, /Salvage \(est\.\) gir mest, vendor er lavere/);

  const v = recommend(row(armor(200)), ctx({ prices: new Map([[T2.cloth, buyOnly(50)]]) }));
  assert.equal(v.action, 'vendor');
  assert.match(v.reason, /Vendor slår salvage/);

  const t = recommend(row(armor(200)), ctx({ prices: new Map([[T2.cloth, buyOnly(50)], [30, price(1000, 900)]]) }));
  assert.equal(t.action, 'tp');
  assert.equal(t.unitValue, Math.floor(999 * 0.85));
  assert.match(t.reason, /TP gir mest \(vendor er lavere\)/);

  // nesten likt: vendor 95 mot salvage 93
  const n = recommend(row(armor(95)), ctx({ prices: new Map([[T2.cloth, buyOnly(50)]]) }));
  assert.equal(n.action, 'vendor');
  assert.match(n.reason, /Nesten likt/);
});

test('salvage-anslag følger vektklasse, våpen bruker metall og tre, trinkets gir null', () => {
  const p = new Map([[T2.cloth, buyOnly(10)], [T2.leather, buyOnly(20)], [T2.metal, buyOnly(30)], [19726, buyOnly(50)]]); // 19726 = T2 tre
  const mk = (type, w) => item({ type, rarity: 'Basic', level: 20, details: w ? { weight_class: w } : {} });
  assert.equal(salvageEstimate(mk('Armor', 'Light'), p), Math.round(10 * 1.8));
  assert.equal(salvageEstimate(mk('Armor', 'Medium'), p), Math.round(20 * 1.8));
  assert.equal(salvageEstimate(mk('Armor', 'Heavy'), p), Math.round(30 * 1.8));
  assert.equal(salvageEstimate(mk('Weapon'), p), Math.round((30 + 50) / 2 * 1.8));
  assert.equal(salvageEstimate(mk('Trinket'), p), 0);
  assert.equal(salvageEstimate(item({ type: 'Armor', rarity: 'Basic', level: 20, flags: ['NoSalvage'] }), p), 0);
  assert.equal(salvageEstimate(item({ type: 'CraftingMaterial' }), p), 0);
});

test('rare level 80-utstyr som ikke salvages får ecto-hint i begrunnelsen', () => {
  const it = item({ id: 40, type: 'Weapon', rarity: 'Rare', level: 80, vendor_value: 4000 });
  const r = recommend(row(it), ctx({ prices: new Map([[ECTO_ID, buyOnly(3000)]]) }));
  assert.equal(r.action, 'vendor');
  assert.match(r.reason, new RegExp(`Salvage gir ~${Math.round(3000 * 0.875 - 40)}c i ecto`));
});

test('listed: item som allerede ligger ute for salg flagges og nevnes', () => {
  const it = item({ id: 50, type: 'Trophy', vendor_value: 10 });
  const r = recommend(row(it), ctx({ listed: new Set([50]) }));
  assert.ok(r.flags.includes('listed'));
  assert.match(r.reason, /ute for salg/);
  const ikke = recommend(row(it), ctx());
  assert.ok(!ikke.flags.includes('listed'));
  assert.doesNotMatch(ikke.reason, /ute for salg/);
});

test('binding, AccountBound og NoSell hindrer TP og vendor', () => {
  const it = item({ id: 60, type: 'Trophy', vendor_value: 10 });
  const c = ctx({ prices: new Map([[60, price(5000, 4000)]]) });
  const bundet = recommend(row(it, { binding: 'Account' }), c);
  assert.equal(bundet.tpList, 0);
  assert.equal(bundet.tpInstant, 0);
  assert.equal(bundet.action, 'vendor');
  const flagget = recommend(row(item({ ...it, flags: ['AccountBound'] })), c);
  assert.equal(flagget.action, 'vendor');
  const soul = recommend(row(item({ ...it, flags: ['SoulbindOnAcquire'] })), c);
  assert.equal(soul.tpList, 0);
  const nosell = recommend(row(item({ ...it, flags: ['NoSell', 'AccountBound'] })), c);
  assert.equal(nosell.vendor, 0);
  assert.equal(nosell.action, 'keep');
  assert.match(nosell.reason, /verken selges eller salvages/);
});

test('beholdere: TP hvis stacken er verdt mer enn dobbel vendor, ellers Åpne', () => {
  const it = item({ id: 70, type: 'Container', vendor_value: 10 });
  const tp = recommend(row(it), ctx({ prices: new Map([[70, price(500, 400)]]) }));
  assert.equal(tp.action, 'tp');
  const åpne = recommend(row(it), ctx());
  assert.equal(åpne.action, 'open');
  assert.equal(åpne.label, 'Åpne');
  const billig = recommend(row(it, { count: 20 }), ctx({ prices: new Map([[70, price(20, 10)]]) }));
  assert.equal(billig.action, 'open', 'stacken når terskelen, men TP er ikke dobbel vendor');
});

test('forbruksvarer: god TP-pris selges, ellers brukes, bundet brukes', () => {
  const it = item({ id: 80, type: 'Consumable', vendor_value: 5 });
  const tp = recommend(row(it), ctx({ prices: new Map([[80, price(300, 200)]]) }));
  assert.equal(tp.action, 'tp');
  assert.match(tp.reason, /god TP-pris/);
  const bruk = recommend(row(it), ctx({ prices: new Map([[80, price(50, 40)]]) }));
  assert.equal(bruk.action, 'use');
  assert.match(bruk.reason, /bruk den eller vendor/);
  const bundet = recommend(row(it, { binding: 'Character' }), ctx());
  assert.equal(bundet.action, 'use');
  assert.match(bundet.reason, /Bundet/);
});

test('verktøy, poser og nøkler beholdes med mindre TP-prisen er god', () => {
  for (const type of ['Bag', 'Gathering', 'Tool', 'Gizmo', 'Key', 'Relic']) {
    const r = recommend(row(item({ id: 90, type })), ctx());
    assert.equal(r.action, 'keep', type);
  }
  const tp = recommend(row(item({ id: 90, type: 'Bag' })), ctx({ prices: new Map([[90, price(1000, 900)]]) }));
  assert.equal(tp.action, 'tp');
});
