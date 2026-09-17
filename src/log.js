'use strict';
// Enkel filbasert logger uten avhengigheter. Skriver til <userData>/logs/app.log og til console.
// Rotasjon ved 2 MB: app.log -> app.log.1 -> app.log.2. Linjer logget før init() bufres og skrives ved init.
const fs = require('fs');
const path = require('path');
const secrets = require('./secrets');

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP = 2; // antall roterte filer som beholdes (app.log.1, app.log.2)
const FILE = 'app.log';

let dir = '';
let file = '';
let size = 0;
const pending = []; // linjer før init

function init(app) {
  dir = path.join(app.getPath('userData'), 'logs');
  file = path.join(dir, FILE);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* skrives til console uansett */ }
  try { size = fs.statSync(file).size; } catch { size = 0; }
  for (const line of pending.splice(0)) append(line);
}

function rotate() {
  try {
    for (let i = KEEP; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      const to = `${file}.${i}`;
      if (fs.existsSync(to)) fs.unlinkSync(to);
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
  } catch { /* rotasjon feilet, fortsett å skrive i samme fil */ }
  size = 0;
}

function append(line) {
  line = secrets.redact(line);
  if (!file) { pending.push(line); if (pending.length > 500) pending.shift(); return; }
  const bytes = Buffer.byteLength(line, 'utf8') + 1;
  if (size + bytes > MAX_BYTES) rotate();
  try { fs.appendFileSync(file, line + '\n'); size += bytes; } catch { /* disk full eller låst */ }
}

// Ekstra-data som én linje: Error gir melding + stack, objekter blir JSON, alt annet String()
function fmtExtra(extra) {
  if (extra == null) return '';
  if (extra instanceof Error) return (extra.stack || extra.message || String(extra)).split('\n').map((s) => s.trim()).join(' | ');
  if (typeof extra === 'string') return extra;
  try { return secrets.stringify(extra); } catch { return String(extra); }
}

function write(level, scope, msg, extra) {
  const text = String(msg ?? '').replace(/\r?\n/g, ' | ');
  const ex = fmtExtra(extra);
  const line = secrets.redact(`${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${text}${ex ? ' ' + ex : ''}`);
  const out = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  out(line);
  append(line);
}

const info = (scope, msg, extra) => write('INFO', scope, msg, extra);
const warn = (scope, msg, extra) => write('WARN', scope, msg, extra);
const error = (scope, msg, extra) => write('ERROR', scope, msg, extra);
const debug = (scope, msg, extra) => write('DEBUG', scope, msg, extra); // brukes av electron-updater sin logger

// Siste n linjer, fra app.log og app.log.1 om nødvendig
function tail(n = 200) {
  const lines = [];
  for (const f of [file, file ? `${file}.1` : '']) {
    if (!f) continue;
    let raw = '';
    try { raw = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const arr = raw.split('\n').filter(Boolean);
    lines.unshift(...arr.slice(-n));
    if (lines.length >= n) break;
  }
  return lines.slice(-n).map(secrets.redact);
}

function logPath() { return dir; }

module.exports = { init, info, warn, error, debug, tail, path: logPath, file: () => file };
