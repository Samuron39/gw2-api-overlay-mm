'use strict';
// Konfig for hovedprosessen: standardverdier, lasting og lagring (atomisk via .tmp), og det som deles med renderer.
// Holder også miljøflaggene DEMO (GW2_DEMO) og TEST_MODE (GW2_SHOT) som resten av hovedprosessen bruker.
const fs = require('fs');
const log = require('./log');
const i18n = require('./i18n');

const DEFAULT_CONFIG = {
  apiKey: '',
  lmUrl: 'http://localhost:1234/v1',
  lmModel: 'google/gemma-4-12b-qat', // liten nok til å ligge ved siden av spillet
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
const TEST_MODE = !!process.env.GW2_SHOT;

let configPath = '';
let config = { ...DEFAULT_CONFIG };
let lastSaveError = '';
let saveTimer = null;
let extras = () => ({}); // felt som legges på publicConfig() (demo, dpsDefaultDir, appVersion), satt av main.js

// path: konfigfila. extra: funksjon som gir ekstra felt til publicConfig()
function init({ path, extra }) {
  configPath = path;
  if (extra) extras = extra;
}

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...DEFAULT_CONFIG, ...saved, wheel: { ...DEFAULT_CONFIG.wheel, ...(saved.wheel || {}) }, panel: { ...DEFAULT_CONFIG.panel, ...(saved.panel || {}) } };
  } catch { config = { ...DEFAULT_CONFIG }; }
  if (!config.lmModel) config.lmModel = DEFAULT_CONFIG.lmModel;
  i18n.setLanguage(config.language);
}

// Lagrer konfig og kontrollerer at fila faktisk ble skrevet. Skriver først til .tmp og døper om (atomisk);
// svikter omdøpingen (låst fil, antivirus) skrives fila direkte. Avvik logges, så feilrapporten viser hva som skjedde.
function saveConfig() {
  if (!configPath) { lastSaveError = 'Ingen konfigsti'; log.error('config', lastSaveError); return; }
  const data = JSON.stringify(config, null, 2);
  const tmp = configPath + '.tmp';
  try {
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, configPath);
    } catch (e) {
      log.warn('config', 'Omdøping feilet, skriver direkte: ' + e.message);
      try { fs.unlinkSync(tmp); } catch { /* ingen tmp */ }
      fs.writeFileSync(configPath, data);
    }
    const back = fs.readFileSync(configPath, 'utf8');
    if (back !== data) throw new Error('Fila på disk stemmer ikke med det som ble skrevet (' + back.length + ' vs ' + data.length + ' tegn)');
    lastSaveError = '';
    log.debug('config', 'Lagret ' + data.length + ' tegn til ' + configPath);
  } catch (e) {
    lastSaveError = e.message;
    log.error('config', 'Kunne ikke lagre konfig: ' + configPath, e.message);
  }
}

function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveConfig, 400); }

function publicConfig() { return { ...config, configPath, lastSaveError, ...extras() }; }

module.exports = {
  DEFAULT_CONFIG, DEMO, TEST_MODE,
  init, loadConfig, saveConfig, saveSoon, publicConfig,
  // config byttes ut ved loadConfig(), så bruk getteren i stedet for å holde på objektet før lasting
  get config() { return config; },
  get configPath() { return configPath; },
  get lastSaveError() { return lastSaveError; },
};
