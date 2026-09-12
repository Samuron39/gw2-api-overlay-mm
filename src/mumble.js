'use strict';
// Starter Rust-hjelperen (helper/) som leser MumbleLink og sender siste tilstand til alle vinduer.
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

// Sti til gw2overlay_helper.exe: bygd i helper/target/release under utvikling, kopiert til resources/helper når pakket.
function helperPath() {
  const { app } = require('electron');
  return app?.isPackaged
    ? path.join(process.resourcesPath, 'helper', 'gw2overlay_helper.exe')
    : path.join(__dirname, '..', 'helper', 'target', 'release', 'gw2overlay_helper.exe');
}

class Mumble extends EventEmitter {
  constructor() { super(); this.state = { running: false }; this.proc = null; }

  start() {
    if (this.proc) return;
    const exe = helperPath();
    let failed = false;
    const p = spawn(exe, ['mumble'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let buf = '';
    p.on('error', (e) => {
      failed = true; this.proc = null;
      this.state = { running: false, error: 'Fant ikke hjelperen ' + exe + ' (' + (e.code || e.message) + '). Bygg den med `cargo build --release` i helper/.' };
      this.emit('state', this.state);
    });
    p.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { this.state = JSON.parse(line); this.emit('state', this.state); } catch { /* ignorer */ }
      }
    });
    p.stderr.on('data', (d) => { const s = d.toString().trim(); if (s && this.listenerCount('error')) this.emit('error', s); });
    p.on('exit', (code) => { this.proc = null; if (!failed && code !== 0 && code !== null) setTimeout(() => this.start(), 5000); });
    this.proc = p;
  }

  stop() { if (this.proc) { this.proc.kill(); this.proc = null; } }
}

module.exports = new Mumble();
module.exports.helperPath = helperPath;
