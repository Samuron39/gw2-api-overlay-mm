'use strict';
// Tidsplan-modul (hovedprosess): leverer wiki-datasettet og waypoint-oppslag til renderer.
const fs = require('fs');
const path = require('path');

let cached = null;
function getData() {
  if (cached) return cached;
  const dataDir = path.join(__dirname, '..', '..', 'data');
  const wiki = JSON.parse(fs.readFileSync(path.join(dataDir, 'event-timer-wiki.json'), 'utf8'));
  const waypoints = JSON.parse(fs.readFileSync(path.join(dataDir, 'waypoints.json'), 'utf8'));
  const events = {};
  for (const [key, e] of Object.entries(wiki.events)) {
    if (!e.name || key === 't') continue;
    events[key] = e;
  }
  cached = { events, waypoints, version: wiki.config?.version };
  return cached;
}

module.exports = { getData, ...require('../renderer/timer-logic') };
