'use strict';
// Kjøres automatisk før dist, dist:installer og release (pre-skript i package.json).
// Sjekker at de native binærfilene electron-builder pakker som extraResources finnes, så en pakke
// aldri bygges uten hjelperen (MumbleLink/innliming) og broen (ArcDPS-utvidelsen).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const REQUIRED = [
  { file: 'helper/target/release/gw2overlay_helper.exe', dir: 'helper/' },
  { file: 'bridge/target/release/gw2overlay_bridge.dll', dir: 'bridge/' },
];

const missing = REQUIRED.filter((r) => !fs.existsSync(path.join(root, r.file)));
if (missing.length) {
  console.error('Mangler native binærfiler, pakken kan ikke bygges:');
  for (const m of missing) console.error(`  - ${m.file}   (bygg med: cd ${m.dir} && cargo build --release)`);
  console.error('Krever Rust (https://rustup.rs). Bygg begge én gang, så kjør npm run dist igjen.');
  process.exit(1);
}
console.log('Native binærfiler funnet: ' + REQUIRED.map((r) => path.basename(r.file)).join(', '));
