'use strict';
// Konfig for hovedprosessen: standardverdier, lasting og lagring (atomisk via .tmp), og det som deles med renderer.
// Holder også miljøflaggene DEMO (GW2_DEMO) og TEST_MODE (GW2_SHOT) som resten av hovedprosessen bruker.
const fs = require('fs');
const log = require('./log');
const i18n = require('./i18n');
const secrets = require('./secrets');
const validation = require('./config-validation');

const DEFAULT_CONFIG = {
  apiKey: '',
  lmUrl: 'http://localhost:1234/v1',
  lmModel: 'google/gemma-4-12b-qat', // liten nok til å ligge ved siden av spillet
  aiProvider: 'local', // local | gemini | openai | anthropic | deepseek | xai | custom, se ai-providers.js
  aiProviders: {}, // per leverandør: { apiKey, model, url (bare custom) }
  materialCap: 250,
  minTp: 100,
  keepList: [
    'Mystic Coin', 'Mystic Clover', 'Glob of Ectoplasm', 'Obsidian Shard', 'Pile of Bloodstone Dust',
    'Dragonite Ore', 'Empyreal Fragment', 'Amalgamated Gemstone', 'Charged Quartz', 'Mystic Forge Stone',
    'Black Lion', 'Tome of Knowledge', 'Writ of', 'Spirit Shard', 'Laurel', 'Provisioner Token',
    'Salvage Kit', 'Salvage-o-Matic', 'Gathering Sickle', 'Logging Axe', 'Mining Pick',
  ],
  wheel: { x: null, y: null, locked: false, size: 200 },
  panel: { x: null, y: null, width: 1000, height: 680, pinned: true, opacity: 0.95 },
  dpsLogDir: '',
  timersHidden: ['core-dn', 'eod-dn', 'voe-dn'], // dag/natt-syklusene er støy for de fleste
  autoHide: false, // skjul overlay når verken spillet eller overlayen har fokus
  launchAtStartup: false,
  wheelModules: null, // null = alle moduler på hjulet; ellers liste med id-er
  gw2Dir: '', // mappa med Gw2-64.exe, brukes til ArcDPS-installasjon
  uiScale: 1, // skalering av hjul, panel og overlay-vinduer (1 = 100 %), byttes uten omstart
  followGame: false, // vis overlayen bare når Gw2-64.exe kjører (start med Windows + dette = starter med spillet)
  overlays: {}, // per overlay-vindu (buffs, debuffs, target, skillbar): posisjon, størrelse, utseende
  rotations: {}, // anbefalt rotasjon per karakter/spec: { "<nøkkel>": [{ skill, note }] }
  autoUpdate: true, // sjekk GitHub Releases for ny versjon ved oppstart og hver 6. time (bare pakket app)
  setupDone: false, // Kom i gang-veiviseren åpnes ved oppstart til brukeren huker av «ikke vis igjen»
  language: i18n.DEFAULT_LANGUAGE, // språk i UI-et, én JSON-fil per språk i src/i18n/
};

const DEMO = !!process.env.GW2_DEMO;
const TEST_MODE = DEMO || !!process.env.GW2_SHOT;

let configPath = '';
let config = structuredClone(DEFAULT_CONFIG);
let lastSaveError = '';
let loadWarning = '';
let blocked = false;
let recoveryFile = '';
let saveTimer = null;
let extras = () => ({}); // felt som legges på publicConfig() (demo, dpsDefaultDir, appVersion), satt av main.js
let systemLocale = ''; // Windows-språket (app.getLocale()), brukes bare når konfigen ikke har valgt språk ennå

// path: konfigfila. extra: funksjon som gir ekstra felt til publicConfig(). systemLocale: for språkvalg ved første start
function init({ path, extra, systemLocale: loc }) {
  clearTimeout(saveTimer); saveTimer = null;
  configPath = path;
  lastSaveError = ''; loadWarning = ''; blocked = false; recoveryFile = '';
  if (extra) extras = extra;
  if (loc) systemLocale = loc;
}

function loadConfig() {
  let saved = null;
  let original;
  try {
    original = fs.readFileSync(configPath);
    try { saved = JSON.parse(original.toString('utf8')); }
    catch { loadWarning = i18n.t('config.invalidJson'); }
  } catch (e) {
    if (e.code !== 'ENOENT') { blocked = true; lastSaveError = i18n.t('config.readFailed', { code: e.code || 'IO' }); }
  }
  secrets.rememberConfig(saved);
  const normalized = validation.normalize(original && !loadWarning ? saved : {}, DEFAULT_CONFIG);
  config = normalized.config;
  if (normalized.invalid.length) loadWarning = i18n.t('config.invalidFields', { fields: normalized.invalid.join(', ') });
  if (loadWarning && original) {
    const backup = configPath + '.broken-' + Date.now() + '-' + require('crypto').randomUUID();
    try {
      fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
      if (!fs.readFileSync(backup).equals(original)) throw new Error('VERIFY');
      recoveryFile = backup;
      loadWarning += ' ' + i18n.t('config.backupAt', { path: backup });
    } catch (e) {
      blocked = true;
      lastSaveError = i18n.t('config.backupFailed', { code: e.code || 'VERIFY' });
    }
  }
  // Første start (eller konfig fra før språkvalget fantes): følg Windows-språket. Et lagret valg røres aldri.
  if (!saved || !saved.language) { config.language = i18n.languageForLocale(systemLocale); log.info('config', 'Språk valgt fra systemet: ' + systemLocale + ' -> ' + config.language); }
  if (!config.lmModel) config.lmModel = DEFAULT_CONFIG.lmModel;
  if (!config.aiProviders || typeof config.aiProviders !== 'object') config.aiProviders = {};
  i18n.setLanguage(config.language);
  secrets.rememberConfig(config);
  if (lastSaveError || loadWarning) log.warn('config', lastSaveError || loadWarning);
}

// Lagrer konfig og kontrollerer at fila faktisk ble skrevet. Skriver først til .tmp og døper om (atomisk);
// Feil ved omdøping skal aldri føre til direkte overskriving av originalfilen.
function saveConfig() {
  if (blocked) return false;
  if (!configPath) { lastSaveError = i18n.t('config.noPath'); log.error('config', lastSaveError); return false; }
  secrets.rememberConfig(config);
  const data = JSON.stringify(config, null, 2);
  const tmp = configPath + '.tmp';
  try {
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    if (fs.readFileSync(tmp, 'utf8') !== data) throw new Error('VERIFY');
    fs.renameSync(tmp, configPath);
    const back = fs.readFileSync(configPath, 'utf8');
    if (back !== data) throw new Error('Fila på disk stemmer ikke med det som ble skrevet (' + back.length + ' vs ' + data.length + ' tegn)');
    lastSaveError = '';
    log.debug('config', 'Lagret ' + data.length + ' tegn til ' + configPath);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* originalen røres ikke */ }
    lastSaveError = i18n.t('config.writeFailed', { code: e.code || 'VERIFY' });
    log.error('config', lastSaveError);
    return false;
  }
}

function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = null; saveConfig(); }, 400); }

function applyPatch(patch) {
  let clean;
  try { clean = validation.validatePatch(patch, DEFAULT_CONFIG); }
  catch (e) { throw new Error(i18n.t('config.invalidPatch', { field: String(e.message).slice(0, 80) })); }
  for (const [key, value] of Object.entries(clean)) {
    if (['wheel', 'panel'].includes(key)) Object.assign(config[key], value);
    else if (['aiProviders', 'overlays'].includes(key)) {
      for (const [id, v] of Object.entries(value)) config[key][id] = { ...(config[key][id] || {}), ...v };
    } else config[key] = value;
  }
  secrets.rememberConfig(config);
  return config;
}
function flush() { clearTimeout(saveTimer); if (saveTimer) { saveTimer = null; return saveConfig(); } return true; }
function publicConfig() { return { ...config, configPath, lastSaveError: lastSaveError || loadWarning, recoveryFile, ...extras() }; }

module.exports = {
  DEFAULT_CONFIG, DEMO, TEST_MODE,
  init, loadConfig, saveConfig, saveSoon, publicConfig, applyPatch, flush,
  // config byttes ut ved loadConfig(), så bruk getteren i stedet for å holde på objektet før lasting
  get config() { return config; },
  get configPath() { return configPath; },
  get lastSaveError() { return lastSaveError; },
};
