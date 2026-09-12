'use strict';
// Starter Python-hjelperen som leser MumbleLink og sender siste tilstand til alle vinduer.
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

class Mumble extends EventEmitter {
  constructor() { super(); this.state = { running: false }; this.proc = null; }

  start() {
    if (this.proc) return;
    // Pakket app: hjelperne kopieres til resources/helpers (Python kan ikke lese inne i asar)
    const { app } = require('electron');
    const script = app?.isPackaged ? path.join(process.resourcesPath, 'helpers', 'mumble.py') : path.join(__dirname, 'helpers', 'mumble.py');
    const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
    const tryNext = (i) => {
      if (i >= candidates.length) { this.state = { running: false, error: 'Fant ikke Python. Installer Python 3 for posisjon fra spillet.' }; this.emit('state', this.state); return; }
      const p = spawn(candidates[i], [script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let buf = '';
      let failed = false;
      p.on('error', () => { failed = true; tryNext(i + 1); });
      p.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          try { this.state = JSON.parse(line); this.emit('state', this.state); } catch { /* ignorer */ }
        }
      });
      p.stderr.on('data', (d) => { const s = d.toString(); if (s.includes('Traceback')) this.emit('error', s); });
      p.on('exit', (code) => { this.proc = null; if (!failed && code !== 0 && code !== null) setTimeout(() => this.start(), 5000); });
      this.proc = p;
    };
    tryNext(0);
  }

  stop() { if (this.proc) { this.proc.kill(); this.proc = null; } }
}

module.exports = new Mumble();
