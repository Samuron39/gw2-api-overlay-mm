'use strict';
// DPS-modul (hovedprosess): overvåker ArcDPS-loggmappa og parser logger på forespørsel.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { LogArchive } = require('../log-archive');
const log = require('../log');
const { t } = require('../i18n');

// ArcDPS skriver til Windows' "Dokumenter"-mappe, som ofte er flyttet til OneDrive. Electron kjenner den riktige stien;
// utenfor Electron (tester) faller vi tilbake til hjemmemappa.
function documentsDir() {
  try { const { app } = require('electron'); if (app && app.getPath) return app.getPath('documents'); } catch { /* ikke i Electron */ }
  return path.join(os.homedir(), 'Documents');
}
const DEFAULT_DIR = path.join(documentsDir(), 'Guild Wars 2', 'addons', 'arcdps', 'arcdps.cbtlogs');
const archive = new LogArchive({ warn: (message, error) => log.warn('dps', message, error) });
const listLogs = (...args) => archive.listLogs(...args);
const parseLog = (...args) => archive.parseLog(...args);
const watch = (...args) => archive.watch(...args);

// Last opp en logg til dps.report (kun når brukeren ber om det). Returnerer permalink.
async function upload(file, { signal } = {}) {
  const buf = await fs.promises.readFile(file, { signal });
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(file));
  const { request, LIMITS } = require('../network');
  const j = await request('https://dps.report/uploadContent?json=1&generator=ei', { method: 'POST', body: form }, { signal, timeoutMs: LIMITS.transferMs }, async res => {
    if (!res.ok) throw new Error(t('dps.reportStatus', { status: res.status }));
    return res.json();
  });
  if (j.error) throw new Error(j.error);
  return { permalink: j.permalink, id: j.id };
}

module.exports = { DEFAULT_DIR, listLogs, parseLog, watch, upload, stopWatching: () => archive.stopWatching(), dispose: () => archive.dispose(), get currentDir() { return archive.currentDir; } };
