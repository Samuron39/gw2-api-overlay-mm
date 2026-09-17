'use strict';
// Starter Rust-hjelperen (helper/) som leser MumbleLink og sender siste tilstand til alle vinduer.
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const log = require('./log');
const { t } = require('./i18n');

// Sti til gw2overlay_helper.exe: bygd i helper/target/release under utvikling, kopiert til resources/helper når pakket.
function helperPath() {
  const { app } = require('electron');
  return app?.isPackaged
    ? path.join(process.resourcesPath, 'helper', 'gw2overlay_helper.exe')
    : path.join(__dirname, '..', 'helper', 'target', 'release', 'gw2overlay_helper.exe');
}

class Mumble extends EventEmitter {
  constructor(deps = {}) {
    super(); this.state = { running: false }; this.proc = null;
    this.deps = { spawn, helperPath, setTimeout, clearTimeout, now: Date.now, ...deps };
    this.wanted = false; this.restartTimer = null; this.restarts = 0;
  }

  start() {
    if (this.proc || this.restartTimer) return;
    this.wanted = true; this.restarts = 0; this.launch();
  }
  scheduleRestart() {
    if (!this.wanted || this.restartTimer) return;
    if (this.restarts >= 5) { this.wanted = false; log.error('mumble', 'Hjelperen stoppet etter fem mislykkede omstarter'); return; }
    const delay = Math.min(60000, 2000 * 2 ** this.restarts++);
    log.warn('mumble', 'Starter hjelperen på nytt om ' + delay / 1000 + ' s');
    this.restartTimer = this.deps.setTimeout(() => { this.restartTimer = null; if (this.wanted) this.launch(); }, delay);
    this.restartTimer.unref?.();
  }
  launch() {
    const startedAt = this.deps.now();
    const exe = this.deps.helperPath();
    let failed = false;
    log.info('mumble', 'Starter hjelper', exe);
    const p = this.deps.spawn(exe, ['mumble'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.proc = p;
    let buf = '';
    p.on('error', (e) => {
      if (this.proc !== p) return;
      failed = true; this.proc = null;
      this.state = { running: false, error: t('mumble.noHelper', { exe, code: e.code || e.message }) };
      log.error('mumble', 'Hjelperen kunne ikke startes', e);
      this.emit('state', this.state);
      if (e.code === 'ENOENT' || e.code === 'EACCES') this.wanted = false;
      else this.scheduleRestart();
    });
    p.stdout.on('data', (chunk) => {
      if (this.proc !== p || !this.wanted) return;
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const state = JSON.parse(line);
          if (!state || typeof state.running !== 'boolean') continue;
          this.state = state;
          if (this.deps.now() - startedAt >= 30000) this.restarts = 0;
          this.emit('state', this.state);
        } catch { /* ignorer */ }
      }
    });
    p.stderr.on('data', (d) => { const s = d.toString().trim(); if (s) { log.warn('mumble', s); if (this.listenerCount('error')) this.emit('error', s); } });
    p.on('exit', (code) => {
      if (failed || this.proc !== p) return;
      this.proc = null;
      this.state = { running: false, error: t('mumble.exited', { code: code ?? 'signal' }) };
      this.emit('state', this.state);
      this.scheduleRestart();
    });
  }

  stop() {
    this.wanted = false;
    this.deps.clearTimeout(this.restartTimer); this.restartTimer = null;
    const p = this.proc; this.proc = null;
    p?.kill();
  }
}

module.exports = new Mumble();
module.exports.helperPath = helperPath;
module.exports.Mumble = Mumble;
