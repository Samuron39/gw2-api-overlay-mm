'use strict';
const fs = require('fs');
const path = require('path');
// Kalles før userData brukes. Demo og skjermbildetester deler aldri konfig eller instanslås.
function prepare(app, testMode) {
  if (testMode) {
    const root = path.join(app.getPath('temp'), 'gw2-overlay-test');
    fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, 'run-'));
    fs.mkdirSync(path.join(dir, 'session'));
    app.setPath('userData', dir);
    app.setPath('sessionData', path.join(dir, 'session'));
    return true;
  }
  return app.requestSingleInstanceLock();
}
module.exports = { prepare };
