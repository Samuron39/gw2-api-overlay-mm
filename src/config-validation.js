'use strict';
const plain = (v) => v != null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const safeKey = (key) => !['__proto__', 'prototype', 'constructor'].includes(key);
const number = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const strings = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const bounds = { x: [-100000, 100000], y: [-100000, 100000], width: [480, 10000], height: [320, 10000], w: [80, 10000], h: [40, 10000], size: [140, 320], opacity: [0.1, 1], iconSize: [12, 128], fontSize: [8, 48], showSkills: [0, 30], takenRows: [0, 30], squadRows: [1, 10], delayMs: [0, 30000], count: [1, 8], within: [5, 180], activeMin: [0, 30] };
const enums = { layout: ['grid', 'list'], sort: ['timeAsc', 'timeDesc', 'name', 'stacks'], mode: ['both', 'number', 'clock'], filter: ['all', 'boons', 'conditions', 'other'], direction: ['row', 'col'], view: ['all', 'damage', 'squad', 'taken', 'healing'], period: ['fight', 'last', 'session'], pick: ['count', 'within'] };
// Overlay-vindustypene, ÉN liste for både lagring (config:set) og lasting ved oppstart. 0.4.11 la `bosses` til bare i den ene:
// valget ble lagret, men lukt bort som ugyldig ved neste start, så «Neste verdensbosser» sto avslått igjen etter hver
// oppdatering (meldt av eieren 19. sept 2026). Må stemme med DEFAULTS i src/overlays.js; test/next-bosses.test.js sjekker det.
const OVERLAY_TYPES = Object.freeze(['buffs', 'debuffs', 'target', 'skillbar', 'dps', 'dps2', 'dps3', 'bosses']);
const bools = new Set(['enabled', 'locked', 'pinned', 'minimized', 'showNames', 'showIcons', 'showNext', 'showCooldown', 'showTaken', 'showLast', 'showHealing', 'showSquad', 'showTargetName', 'hideDone']);
function windowPatch(value, allowed) {
  if (!plain(value)) throw new Error('object');
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (!safeKey(key) || (allowed && !allowed.includes(key))) throw new Error(key);
    const valid = key === 'x' || key === 'y' ? v === null || number(v, ...bounds[key])
      : bounds[key] ? number(v, ...bounds[key])
      : enums[key] ? enums[key].includes(v) : bools.has(key) && typeof v === 'boolean';
    if (!valid) throw new Error(key);
    out[key] = v;
  }
  return out;
}
function cleanObject(obj) {
  if (Array.isArray(obj)) return obj.map(cleanObject);
  if (!plain(obj)) return obj;
  return Object.fromEntries(Object.entries(obj).filter(([k]) => safeKey(k)).map(([k, v]) => [k, cleanObject(v)]));
}
function rotation(value) {
  const v = Array.isArray(value) ? { steps: value, upkeep: [] } : value;
  if (!plain(v) || Object.keys(v).some(k => !['steps', 'upkeep'].includes(k))) throw new Error('rotation');
  const out = {};
  for (const [key, text] of [['steps', 'note'], ['upkeep', 'boon']]) {
    const items = v[key] ?? [];
    if (!Array.isArray(items) || items.length > 1000) throw new Error('rotation.' + key);
    out[key] = items.map(item => {
      if (!plain(item) || !Number.isInteger(item.skill) || item.skill <= 0 || (item[text] != null && typeof item[text] !== 'string')) throw new Error('rotation.' + key);
      return { skill: item.skill, [text]: item[text] || '' };
    });
  }
  return out;
}
function field(key, v, defaults) {
  if (!Object.hasOwn(defaults, key) || !safeKey(key)) throw new Error(key);
  if (key === 'wheel' || key === 'panel') return windowPatch(v, Object.keys(defaults[key]));
  if (key === 'overlays') {
    if (!plain(v)) throw new Error(key);
    const out = {};
    for (const [type, patch] of Object.entries(v)) {
      if (!OVERLAY_TYPES.includes(type)) throw new Error(key);
      out[type] = windowPatch(patch);
    }
    return out;
  }
  if (key === 'aiProviders') {
    if (!plain(v)) throw new Error(key);
    for (const [id, provider] of Object.entries(v)) {
      if (!safeKey(id) || !plain(provider) || Object.entries(provider).some(([k, x]) => !['apiKey', 'model', 'url'].includes(k) || typeof x !== 'string')) throw new Error(key);
    }
    return cleanObject(v);
  }
  if (key === 'rotations') {
    if (!plain(v) || Object.keys(v).some(k => !safeKey(k))) throw new Error(key);
    return Object.fromEntries(Object.entries(v).map(([k, r]) => [k, rotation(r)]));
  }
  if (['keepList', 'timersHidden', 'wheelModules'].includes(key)) {
    if (key === 'wheelModules' && v === null) return null;
    if (!strings(v)) throw new Error(key);
    return v.slice();
  }
  if (['materialCap', 'minTp', 'uiScale'].includes(key)) {
    const limits = key === 'uiScale' ? [0.5, 2.5] : key === 'materialCap' ? [1, 10000] : [0, 1e9];
    if (!number(v, ...limits)) throw new Error(key);
  } else if (typeof v !== typeof defaults[key]) throw new Error(key);
  return v;
}
function validatePatch(patch, defaults) {
  if (!plain(patch)) throw new Error('object');
  return Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, field(k, v, defaults)]));
}
function normalize(saved, defaults) {
  const out = structuredClone(defaults), invalid = [];
  if (!plain(saved)) return { config: out, invalid: ['object'] };
  for (const [key, value] of Object.entries(saved)) {
    if (!Object.hasOwn(defaults, key)) continue;
    try {
      // Bevar gyldige nabofelt dersom ett vindusfelt er skadet.
      if ((key === 'wheel' || key === 'panel') && plain(value)) {
        for (const [k, v] of Object.entries(value)) {
          try { Object.assign(out[key], windowPatch({ [k]: v }, Object.keys(defaults[key]))); } catch { invalid.push(key + '.' + k); }
        }
      } else if (key === 'aiProviders' && plain(value)) {
        for (const [id, provider] of Object.entries(value)) {
          if (!safeKey(id) || !plain(provider)) { invalid.push('aiProviders.' + id); continue; }
          out.aiProviders[id] = {};
          for (const [k, v] of Object.entries(provider)) {
            if (['apiKey', 'model', 'url'].includes(k) && typeof v === 'string') out.aiProviders[id][k] = v;
            else invalid.push('aiProviders.' + id + '.' + k);
          }
        }
      } else if (key === 'rotations' && plain(value)) {
        for (const [id, r] of Object.entries(value)) {
          try { if (!safeKey(id)) throw new Error('key'); out.rotations[id] = rotation(r); }
          catch { invalid.push('rotations.' + id); }
        }
      } else if (key === 'overlays' && plain(value)) {
        for (const [type, patch] of Object.entries(value)) {
          if (!OVERLAY_TYPES.includes(type) || !plain(patch)) { invalid.push('overlays.' + type); continue; }
          out.overlays[type] = {};
          for (const [k, v] of Object.entries(patch)) {
            try { Object.assign(out.overlays[type], windowPatch({ [k]: v })); } catch { invalid.push('overlays.' + type + '.' + k); }
          }
        }
      } else out[key] = field(key, value, defaults);
    } catch { invalid.push(key); }
  }
  return { config: out, invalid };
}
module.exports = { plain, safeKey, windowPatch, rotation, validatePatch, normalize, OVERLAY_TYPES };
