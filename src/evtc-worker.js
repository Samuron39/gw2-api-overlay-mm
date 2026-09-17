'use strict';
const { parentPort } = require('worker_threads');
const fs = require('fs');
const evtc = require('./evtc');
const fingerprint = file => { const st = fs.statSync(file); return `${st.mtimeMs}:${st.size}`; };
parentPort.once('message', ({ file, fingerprint: expected }) => {
  try {
    if (fingerprint(file) !== expected) throw Object.assign(new Error('Loggen skrives fortsatt. Prøv igjen.'), { code: 'FILE_CHANGED' });
    const result = evtc.parse(file);
    if (fingerprint(file) !== expected) throw Object.assign(new Error('Loggen ble endret under analysen. Prøv igjen.'), { code: 'FILE_CHANGED' });
    parentPort.postMessage({ result });
  } catch (e) { parentPort.postMessage({ error: { message: e.message, code: e.code } }); }
});
