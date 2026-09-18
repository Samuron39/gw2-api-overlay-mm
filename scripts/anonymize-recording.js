'use strict';
// Anonymiserer et live-opptak («Ta opp strømmen» på Live-fanen) så det kan legges i test/fixtures/.
//   node scripts/anonymize-recording.js <opptak.jsonl> <ut.jsonl.gz>
// Bytter ut alle spillernavn (agenter med elite != 0xffffffff, og src.name i agent-registreringer) og alle kontonavn
// (dst.name i agent-registreringer og alt som ser ut som «navn.1234») med faste, nummererte navn: deg selv = «Testkarakter»,
// andre = «Spiller 1», «Spiller 2» ... NPC-navn, skill-navn, tall og tider røres ikke, så summene er de samme.
// Til slutt kontrolleres det at ingen av de opprinnelige navnene finnes igjen noe sted i fila; ellers skrives ingenting.
const fs = require('fs');
const zlib = require('zlib');

const NPC_ELITE = 0xffffffff;
const ACCOUNT_RE = /^:?[^\s.][^.]*\.\d{4}$/;

function anonymize(text) {
  const names = new Map(); // opprinnelig -> nytt
  let others = 0, accounts = 0;
  const player = (name, self) => {
    if (!names.has(name)) names.set(name, self ? 'Testkarakter' : 'Spiller ' + (++others));
    else if (self && names.get(name) !== 'Testkarakter') names.set(name, 'Testkarakter');
    return names.get(name);
  };
  const account = (name) => { if (!names.has(name)) names.set(name, ':konto.' + String(++accounts).padStart(4, '0')); return names.get(name); };

  const rows = text.split('\n').map((line) => {
    const i = line.indexOf('{');
    if (i < 0) return { line };
    try { return { prefix: line.slice(0, i), m: JSON.parse(line.slice(i)) }; } catch { return { line }; }
  });
  // Første gjennomgang: finn alle navn (self kan være merket først sent i fila)
  for (const { m } of rows) {
    if (!m) continue;
    const reg = m.t === 'agent' && m.src && m.dst;
    for (const side of ['src', 'dst']) {
      const a = m[side];
      if (!a || typeof a !== 'object' || !a.name) continue;
      if (reg && side === 'dst') account(a.name);
      else if (ACCOUNT_RE.test(a.name)) account(a.name);
      else if (reg && side === 'src' && m.dst.elite !== NPC_ELITE && (m.dst.prof || m.dst.self === 1)) player(a.name, m.dst.self === 1);
      else if (a.elite !== NPC_ELITE) player(a.name, a.self === 1);
    }
  }
  const out = rows.map(({ line, prefix, m }) => {
    if (!m) return line;
    for (const side of ['src', 'dst']) { const a = m[side]; if (a && typeof a === 'object' && names.has(a.name)) a.name = names.get(a.name); }
    return prefix + JSON.stringify(m);
  }).join('\n');
  // Kontroll: ingen opprinnelige navn igjen (heller ikke som del av et minion- eller skill-navn)
  const leaked = [...names.keys()].filter((n) => n.length >= 3 && out.includes(n) && !['Testkarakter'].includes(n));
  return { out, replaced: names.size, players: others + ([...names.values()].includes('Testkarakter') ? 1 : 0), accounts, leaked };
}

if (require.main === module) {
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) { console.error('Bruk: node scripts/anonymize-recording.js <opptak.jsonl> <ut.jsonl.gz>'); process.exit(2); }
  const r = anonymize(fs.readFileSync(src, 'utf8'));
  if (r.leaked.length) { console.error(`Stopper: ${r.leaked.length} opprinnelige navn finnes fortsatt i teksten (del av et annet felt?). Ingenting er skrevet.`); process.exit(1); }
  fs.mkdirSync(require('path').dirname(dst), { recursive: true });
  fs.writeFileSync(dst, zlib.gzipSync(r.out, { level: 9 }));
  console.log(`Skrev ${dst}: ${r.players} spillernavn og ${r.accounts} kontonavn byttet ut, ${Math.round(fs.statSync(dst).size / 1024)} kB.`);
}

module.exports = { anonymize };
