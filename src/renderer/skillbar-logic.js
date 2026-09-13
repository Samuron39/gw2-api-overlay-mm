'use strict';
// Ren logikk for skill-baren: velger attunement, kit, legend og transformasjon ut fra live-tilstanden,
// og regner cooldown og ladninger (ammo). Ingen DOM. Lastes både som <script> i overlay.html (window.SkillbarLogic)
// og med require() i testene.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkillbarLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ELEMENTS = ['Fire', 'Water', 'Air', 'Earth'];
  const ALACRITY = 30328;

  // Buff-navn -> attunement. "Fire Attunement" -> {main:'Fire'}, Weaver: "Fire Water Attunement" -> {main:'Fire', off:'Water'},
  // "Dual Fire Attunement" -> {main:'Fire', off:'Fire'}. Andre navn -> null.
  function parseAttunement(name) {
    const m = /^(?:(Dual) )?(Fire|Water|Air|Earth)(?: (Fire|Water|Air|Earth))? Attunement$/.exec(name || '');
    if (!m) return null;
    if (m[1]) return { main: m[2], off: m[2] };
    return { main: m[2], off: m[3] || null };
  }

  // Sist aktiverte skills først (minst sinceMs)
  function firedByRecency(snap) {
    return (snap?.cooldowns || []).filter((c) => c.fired).slice().sort((a, b) => a.sinceMs - b.sinceMs);
  }

  /**
   * Aktiv attunement. Først buff på deg (dekker også Weaver sine to attunements), ellers de sist aktiverte
   * attunement-skillene (nyeste = hovedhånd, nest nyeste = offhånd for Weaver), ellers Fire.
   * attunementIds: { skillId: 'Fire' | 'Water' | ... }
   */
  function pickAttunement(snap, attunementIds) {
    for (const b of snap?.buffs || []) { const a = parseAttunement(b.name); if (a) return a; }
    const ids = attunementIds || {};
    const seen = [];
    for (const c of firedByRecency(snap)) { const el = ids[c.skill]; if (el && !seen.includes(el)) seen.push(el); if (seen.length === 2) break; }
    if (seen.length) return { main: seen[0], off: seen[1] || null };
    return { main: 'Fire', off: null };
  }

  /**
   * Våpenskills 1–5 for et sett med attunements. set.attunements = { Fire: [5], ... }, set.dual (Weaver) = { 'Fire/Water': skill3, ... }.
   * Weaver: 1–2 fra hovedhåndens attunement, 3 dual-skillet, 4–5 fra offhåndens attunement.
   */
  function attunementWeapon(set, main, off) {
    const att = set?.attunements;
    if (!att) return set?.skills || [];
    const m = att[main] || att[ELEMENTS[0]] || [];
    if (!set.dual) return m.slice(0, 5);
    const o = (off && att[off]) || m;
    const w3 = (off && off !== main && set.dual[`${main}/${off}`]) || m[2] || null;
    return [m[0] || null, m[1] || null, w3, o[3] || null, o[4] || null];
  }

  /**
   * Aktivt kit/bundle. kits = { id: { id, name, ids: [alle skill-id-er som starter kitet], stow: [skill-id-er som legger det bort], skills: [5] } }.
   * Buff på deg med kitets navn ("Grenade Kit", "Elixir Gun"), ellers sist aktiverte kit- eller stow-skill.
   */
  function pickKit(snap, kits) {
    const list = Object.values(kits || {});
    if (!list.length) return null;
    const buffs = snap?.buffs || [];
    for (const k of list) if (buffs.some((b) => b.name === k.name)) return k.id;
    for (const c of firedByRecency(snap)) {
      for (const k of list) {
        if ((k.stow || []).includes(c.skill)) return null;
        if ((k.ids || []).includes(c.skill)) return k.id;
      }
    }
    return null;
  }

  /**
   * Aktiv legend (Revenant). legends = { key: { key, name (stance-skillets navn), swap: skillId, ... } }, order = [key, key].
   * Buff på deg "Legendary X Stance", ellers sist aktiverte swap-skill, ellers første i builden.
   */
  function pickLegend(snap, legends, order) {
    const list = (order || Object.keys(legends || {})).map((k) => legends?.[k]).filter(Boolean);
    if (!list.length) return null;
    const buffs = (snap?.buffs || []).filter((b) => /^Legendary /.test(b.name || ''));
    for (const l of list) {
      const stem = String(l.name || '').replace(/ Stance$/, '');
      if (stem && buffs.some((b) => b.name === l.name || b.name.startsWith(stem))) return l.key;
    }
    for (const c of firedByRecency(snap)) for (const l of list) if (l.swap === c.skill) return l.key;
    return list[0].key;
  }

  /**
   * Aktiv transformasjon (shroud, Berserk, Celestial Avatar, elite-transformasjoner). forms = { buffNavn: { weapon?: [5], profession?: [5] } }.
   * Buff med samme navn som formen, ellers en buff som inneholder "Shroud" når det bare finnes én shroud-form.
   */
  function pickForm(snap, forms) {
    const keys = Object.keys(forms || {});
    if (!keys.length) return null;
    const buffs = snap?.buffs || [];
    for (const k of keys) if (buffs.some((b) => b.name === k)) return k;
    const shroud = keys.filter((k) => /Shroud/.test(k));
    if (shroud.length === 1 && buffs.some((b) => /Shroud/.test(b.name || ''))) return shroud[0];
    return null;
  }

  function hasAlacrity(snap) { return (snap?.buffs || []).some((b) => b.skill === ALACRITY); }

  // Cooldown i sekunder: API-ets Recharge, overstyrt av traited_facts når builden har traiten, 25 % kortere med alacrity
  function cooldownSeconds(skill, traits, alacrity) {
    let s = skill?.recharge || 0;
    for (const f of skill?.traited || []) if (f.type === 'Recharge' && f.value && (traits || []).includes(f.requires_trait)) s = f.value;
    return alacrity ? s * 0.75 : s;
  }

  // Ladninger: { count, recharge } fra "Maximum Count" og "Count Recharge" (uten Count Recharge brukes vanlig Recharge),
  // traited Count Recharge når builden har traiten. null uten ammo.
  function ammoFor(skill, traits, alacrity) {
    if (!skill?.ammo?.count) return null;
    let r = skill.ammo.recharge || skill.recharge || 0;
    for (const f of skill.traited || []) if (f.text === 'Count Recharge' && f.duration && (traits || []).includes(f.requires_trait)) r = f.duration;
    return { count: skill.ammo.count, recharge: alacrity ? r * 0.75 : r };
  }

  // Ladningstilstand { charges, nextAt }. ammoUse ved aktivering, ammoTick før tegning.
  function ammoUse(state, max, rechargeMs, now) {
    const s = state || { charges: max, nextAt: 0 };
    if (s.charges > 0) s.charges -= 1;
    if (s.charges < max && !s.nextAt && rechargeMs > 0) s.nextAt = now + rechargeMs;
    return s;
  }
  function ammoTick(state, max, rechargeMs, now) {
    const s = state || { charges: max, nextAt: 0 };
    while (s.nextAt && now >= s.nextAt) {
      s.charges = Math.min(max, s.charges + 1);
      s.nextAt = s.charges < max && rechargeMs > 0 ? s.nextAt + rechargeMs : 0;
    }
    return s;
  }

  // Hold-oppe med toleranse for ArcDPS-forsinkelsen. Evtc-kanalen kommer 2–3 s etter spillet, så en boon du nettopp la på
  // ser ut som borte til påføringen kommer fram. noteBoons husker når hver boon sist var på deg (med litt tid igjen);
  // upkeepMissing sier at en boon mangler først når den ikke er sett på delayMs. since = når vi begynte å se (tilkobling),
  // så boons vi aldri har sett også får samme toleranse fra start.
  function noteBoons(buffs, seen, now, minRemainingMs = 1500) {
    for (const b of buffs || []) if (b.remainingMs > minRemainingMs) seen.set(String(b.name || '').toLowerCase(), now);
  }
  function upkeepMissing(upkeep, skillId, seen, since, now, delayMs) {
    const out = [];
    for (const u of upkeep || []) {
      if (u.skill !== skillId) continue;
      const last = seen.get(String(u.boon).toLowerCase());
      if (now - (last == null ? since : last) > delayMs) out.push(u.boon);
    }
    return out;
  }

  return { ELEMENTS, parseAttunement, pickAttunement, attunementWeapon, pickKit, pickLegend, pickForm, hasAlacrity, cooldownSeconds, ammoFor, ammoUse, ammoTick, noteBoons, upkeepMissing };
});
