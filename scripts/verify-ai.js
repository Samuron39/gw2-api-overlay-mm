'use strict';
// Verifiserer appens AI-klient mot en EKTE lokal LM Studio (ikke mock). Kjøres når spillet IKKE går, fordi modellen bruker skjermkortet:
//   lms server start
//   lms load <modell-id> --context-length 16384 --gpu max -y
//   node scripts/verify-ai.js [modell-id]
// Tre sjekker: (1) et vanlig svar med resonnering kommer fram og er ikke tomt, (2) avbrudd midt i strømmen stopper innen
// et par sekunder og gir aldri et delsvar, (3) et ekte guide-utdrag fra wikien gir gyldig struktur med chat-linjer.
// Bruker ingen API-nøkler og leser ikke appens konfig. Starter ikke overlayen. Guide-cachen legges i en temp-mappe.
const os = require('os');
const fs = require('fs');
const path = require('path');
const ai = require('../src/ai');
const guides = require('../src/modules/guides');

const url = process.env.LM_URL || 'http://localhost:1234/v1';
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ name, ok: true, s: ((Date.now() - t0) / 1000).toFixed(1), note }); }
  catch (e) { results.push({ name, ok: false, s: ((Date.now() - t0) / 1000).toFixed(1), note: e.message }); }
};

(async () => {
  let model = process.argv[2];
  const cfgFor = (m) => ({ aiProvider: 'local', lmUrl: url, lmModel: m, aiProviders: {} });
  await step('LM Studio svarer og har en modell', async () => {
    const models = await ai.listModels(cfgFor(model || ''));
    if (!models.length) throw new Error('ingen modeller. Kjør: lms server start, og last en modell');
    if (!model) model = models[0].id || models[0];
    return `${models.length} modell(er), bruker ${model}`;
  });
  if (!results[0].ok) return report();
  const cfg = cfgFor(model);

  await step('svar med resonnering kommer fram', async () => {
    let reasoning = 0, content = 0;
    const text = await ai.completeText(cfg, [{ role: 'user', content: 'Svar med nøyaktig ett ord: hvilken profesjon i Guild Wars 2 bruker attunements?' }], {
      maxTokens: 3000, onProgress: (p) => { reasoning = Math.max(reasoning, p.reasoning || 0); content = Math.max(content, p.content || 0); },
    });
    if (!text || !text.trim()) throw new Error('tomt svar');
    if (/<think>/i.test(text)) throw new Error('think-blokk lekket ut i svaret');
    return `svar «${text.trim().slice(0, 40)}», resonnering ${reasoning} tegn, innhold ${content} tegn`;
  });

  await step('avbrudd midt i strømmen stopper raskt og gir ikke delsvar', async () => {
    const controller = new AbortController();
    let started = 0;
    const p = ai.completeText(cfg, [{ role: 'user', content: 'Skriv en svært lang og detaljert gjennomgang av alle ni profesjonene i Guild Wars 2, minst 2000 ord.' }], {
      maxTokens: 6000, signal: controller.signal,
      onProgress: (x) => { if (!started && (x.reasoning || x.content)) { started = Date.now(); setTimeout(() => controller.abort(), 1500); } },
    });
    let text = null, err = null;
    try { text = await p; } catch (e) { err = e; }
    if (!started) throw new Error('strømmen startet aldri');
    if (text != null) throw new Error('fikk et svar tilbake etter avbrudd (' + text.length + ' tegn)');
    const ms = Date.now() - started - 1500;
    if (ms > 3000) throw new Error('brukte ' + ms + ' ms på å stoppe');
    return `stoppet ${ms} ms etter avbrudd (${err.code || err.name})`;
  });

  await step('ekte guide-utdrag fra wikien', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-overlay-verify-'));
    try {
      guides.init(dir);
      const id = Object.values(guides.list().groups)[0][0].id;
      const g = await guides.get(cfg, id, { refresh: true, language: 'norsk bokmål' });
      if (g.error) throw new Error(g.error.code + ': ' + g.error.message);
      if (!g.summary.length || !g.chat.length) throw new Error(`tomt utdrag (sammendrag ${g.summary.length}, chat ${g.chat.length})`);
      const long = g.chat.filter((l) => l.length > guides.CHAT_MAX);
      if (long.length) throw new Error(long.length + ' chat-linje(r) er lengre enn spillets grense');
      return `${g.title}: ${g.summary.length} sammendragslinjer, ${g.chat.length} chat-linjer, ${g.tips.length} tips, modell ${g.model}`;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  report();
})();

function report() {
  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FEIL'} ${r.name} (${r.s} s)${r.note ? ': ' + r.note : ''}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
