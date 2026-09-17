'use strict';
// Kom i gang-veiviseren (hovedprosess): én samlet sjekk av alt som må være på plass før overlayen brukes i spillet.
// Renderer-delen ligger i renderer/modules/setup.js. Sjekken er ren lesing; installasjon går via arc:*-kanalene.
const fs = require('fs');
const path = require('path');

// Tillatelsene en API-nøkkel kan ha, og hva appen bruker dem til
const REQUIRED_PERMS = ['account', 'inventories', 'characters', 'wallet'];
const RECOMMENDED_PERMS = ['builds', 'unlocks', 'progression', 'tradingpost', 'guilds'];

// Hvilke tillatelser som mangler, delt i påkrevde og anbefalte
function missingPermissions(perms) {
  const has = new Set(perms || []);
  return {
    required: REQUIRED_PERMS.filter((p) => !has.has(p)),
    recommended: RECOMMENDED_PERMS.filter((p) => !has.has(p)),
  };
}

// Samlet status. deps: { gw2, arcdps, dps, ai, mumble } så modulen kan testes uten Electron.
async function check(config, deps, options = {}) {
  const { gw2, arcdps, dps, ai, mumble } = deps;
  const out = {};

  const tasks = [];
  tasks.push(async () => {
    // 1. API-nøkkel
    out.key = { set: !!config.apiKey, valid: false, name: '', permissions: [], missing: { required: REQUIRED_PERMS, recommended: RECOMMENDED_PERMS }, error: '' };
    if (config.apiKey) {
      try {
        const token = await gw2.get('/tokeninfo', { key: config.apiKey, signal: options.signal });
        out.key.valid = true;
        out.key.permissions = token.permissions || [];
        out.key.missing = missingPermissions(out.key.permissions);
        try { out.key.name = (await gw2.get('/account', { key: config.apiKey, signal: options.signal })).name || ''; } catch { /* account-tillatelse mangler */ }
      } catch (e) { out.key.error = e.message; }
    }

  });
  tasks.push(async () => {
    // 2. Spillmappe
    out.game = { dir: '', valid: false, saved: !!config.gw2Dir, running: false, error: '' };
    out.arc = { installed: false, updateAvailable: false, bridge: { available: false, installed: false, upToDate: false }, error: '' };
    try {
      const dir = arcdps.isGameDir(config.gw2Dir) ? config.gw2Dir : await arcdps.detectDir();
      out.game = { dir, valid: arcdps.isGameDir(dir), saved: !!config.gw2Dir, running: await arcdps.gameRunning() };

      // 3. ArcDPS og broen
      if (out.game.valid) {
        try {
          const s = await arcdps.status(dir, options);
          out.arc = { installed: s.installed, updateAvailable: s.updateAvailable, bridge: s.bridge, error: s.error || '' };
        } catch (e) { out.arc.error = e.message; }
      }

    } catch (e) { out.game.error = e.message; }
  });
  tasks.push(async () => {
    // 4. Loggmappe
    const logDir = config.dpsLogDir || dps.DEFAULT_DIR;
    out.logs = { dir: logDir, custom: !!config.dpsLogDir, exists: false, count: 0, error: '' };
    try {
      out.logs.exists = (await fs.promises.stat(logDir)).isDirectory();
      if (out.logs.exists) out.logs.count = (await dps.listLogs(logDir, 5, options)).length;
    } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') out.logs.error = e.message; }
  });
  tasks.push(async () => {
    // 5. Lokal AI (valgfri)
    const d = ai.describe(config);
    out.ai = { provider: d.provider, name: d.name, url: d.url, needsKey: d.needsKey, hasKey: d.hasKey, ok: false, models: 0, model: d.model, modelLoaded: false, error: '' };
    if (d.needsKey && !d.hasKey) out.ai.error = 'NOKEY';
    else {
      try {
        const models = await ai.listModels(config, options);
        out.ai.ok = true; out.ai.models = models.length; out.ai.modelLoaded = !!d.model && models.includes(d.model);
      } catch (e) { out.ai.error = e.message; }
    }
  });
  // Maks tre uavhengige sjekker samtidig; spillmappe må fortsatt være kjent før ArcDPS-status.
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (tasks.length) { options.signal?.throwIfAborted(); await tasks.shift()(); }
  }));
  options.signal?.throwIfAborted();

  // 6. Hjelperen (MumbleLink og chat-innliming)
  out.helper = { ok: !mumble.state?.error, error: mumble.state?.error || '', gameSeen: !!mumble.state?.running };

  // 7. Oppstart
  out.startup = { followGame: !!config.followGame, launchAtStartup: !!config.launchAtStartup };
  out.appDir = path.dirname(process.execPath);
  return out;
}

module.exports = { check, missingPermissions, REQUIRED_PERMS, RECOMMENDED_PERMS };
