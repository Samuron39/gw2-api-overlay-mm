'use strict';
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const pages = new Set(['wheel.html', 'panel.html', 'overlay.html'].map((f) => path.resolve(__dirname, 'renderer', f).toLowerCase()));
function trustedSender(event) {
  try {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'file:' && pages.has(path.resolve(fileURLToPath(url)).toLowerCase());
  } catch { return false; }
}
function logFile(dir, file) {
  if (typeof file !== 'string' || !/\.z?evtc$/i.test(file)) throw new Error('security.logPath');
  try {
    const root = fs.realpathSync(dir), target = fs.realpathSync(file);
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !fs.statSync(target).isFile()) throw new Error('OUTSIDE');
    return target;
  } catch { throw new Error('security.logPath'); }
}
function guardNavigation(contents) {
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
module.exports = { trustedSender, logFile, guardNavigation };
