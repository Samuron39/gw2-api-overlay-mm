'use strict';
// DPS-modul (hovedprosess): overvåker ArcDPS-loggmappa og parser logger på forespørsel.
const fs = require('fs');
const path = require('path');
const os = require('os');
const evtc = require('../evtc');

const DEFAULT_DIR = path.join(os.homedir(), 'Documents', 'Guild Wars 2', 'addons', 'arcdps', 'arcdps.cbtlogs');
const cache = new Map();
let watcher = null;
let onNew = null;
let currentDir = null;
const pendingTimers = new Map();
const LOG_RE = /\.z?evtc$/i;

function listLogs(dir, limit = 40) {
  const out = [];
  const walk = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1); continue; }
      if (LOG_RE.test(e.name)) {
        try { const st = fs.statSync(p); out.push({ file: p, name: e.name, folder: path.basename(d), mtime: st.mtimeMs, size: st.size }); } catch { /* hopp over */ }
      }
    }
  };
  walk(dir, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit);
}

function parseLog(file) {
  const st = fs.statSync(file);
  const key = file + ':' + st.mtimeMs + ':' + st.size;
  if (cache.has(key)) return cache.get(key);
  const r = evtc.parse(file);
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  cache.set(key, r);
  return r;
}

function watch(dir, cb) {
  onNew = cb;
  if (watcher) { watcher.close(); watcher = null; }
  currentDir = dir;
  if (!fs.existsSync(dir)) return false;
  try {
    watcher = fs.watch(dir, { recursive: true }, (_ev, filename) => {
      if (!filename || !LOG_RE.test(filename)) return;
      const full = path.join(dir, filename);
      // ArcDPS skriver fila over litt tid; vent til den er stabil
      clearTimeout(pendingTimers.get(full));
      pendingTimers.set(full, setTimeout(() => {
        pendingTimers.delete(full);
        try { onNew?.(parseLog(full)); } catch { /* halvskrevet fil eller ukjent format */ }
      }, 2500));
    });
    return true;
  } catch { return false; }
}

// Last opp en logg til dps.report (kun når brukeren ber om det). Returnerer permalink.
async function upload(file) {
  const buf = fs.readFileSync(file);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(file));
  const res = await fetch('https://dps.report/uploadContent?json=1&generator=ei', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`dps.report svarte ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return { permalink: j.permalink, id: j.id };
}

module.exports = { DEFAULT_DIR, listLogs, parseLog, watch, upload, get currentDir() { return currentDir; } };
