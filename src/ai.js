'use strict';
// AI-klient. Standard er LM Studio lokalt (ingen data forlater maskinen); alternativt en skyleverandør valgt i
// Innstillinger (Gemini, OpenAI, Anthropic, DeepSeek, xAI eller egendefinert). Alle bruker OpenAI-formatet, se ai-providers.js.
// Systemprompten er norsk, men modellen bes svare på språket brukeren har valgt (ai.language i språkfila).
const { t } = require('./i18n');
const providers = require('./ai-providers');
const { request, LIMITS } = require('./network');

function target(cfg) {
  const r = providers.resolve(cfg);
  if (!r.url) throw new Error(t('ai.noUrl', { name: r.name }));
  if (r.needsKey && !r.apiKey) throw new Error(t('ai.noKey', { name: r.name }));
  return r;
}

async function listModels(cfg, opts = {}) {
  const r = target(cfg);
  return request(r.url + '/models', { headers: providers.headers(r) }, opts, async (res) => {
    if (!res.ok) throw new Error(t('ai.status', { name: r.name, status: res.status }));
    return providers.parseModels(await res.json());
  });
}

// Kort beskrivelse til UI-et: leverandør og modell
function describe(cfg) { const r = providers.resolve(cfg); return { provider: r.id, name: r.name, model: r.model, url: r.url, needsKey: r.needsKey, hasKey: !!r.apiKey }; }

async function complete(cfg, messages, opts = {}) {
  const r = target(cfg);
  // Resonneringsmodeller (Qwen3, Gemma 4) tenker først og legger tenkingen i delta.reasoning_content.
  // Tenkingen teller mot token-budsjettet, så det må være romslig, ellers blir svaret tomt.
  const body = providers.buildBody(r, messages, opts); // stream: true, ellers stopper Node etter 5 min uten svarhoder
  const fail = (key) => { const e = new Error(t(key, { name: r.name })); e.aiResponse = true; return e; };
  try {
    return await request(r.url + '/chat/completions', { method: 'POST', headers: providers.headers(r), body: JSON.stringify(body) }, {
      signal: opts.signal, timeoutMs: opts.timeoutMs ?? LIMITS.aiTotalMs,
      firstByteMs: opts.firstByteMs ?? LIMITS.aiFirstByteMs, idleMs: opts.idleMs ?? LIMITS.aiIdleMs,
    }, async (res, task) => {
      if (res.status === 429) throw fail('ai.rateLimited');
      if (!res.ok) { const e = new Error(t('ai.status', { name: r.name, status: res.status })); e.aiResponse = true; throw e; }
      let content = '', reasoning = 0, complete = false, done = false;
      const accept = (j, json = false) => {
        if (!j || typeof j !== 'object') throw fail('ai.invalidResponse');
        if (j.error) throw fail('ai.providerError');
        const c = j.choices?.[0];
        if (!c) return;
        if (c.finish_reason && c.finish_reason !== 'stop') throw fail('ai.incomplete');
        if (c.finish_reason === 'stop') complete = true;
        const d = (json ? c.message : c.delta) || {};
        if (typeof d.reasoning_content === 'string') reasoning += d.reasoning_content.length;
        if (typeof d.content === 'string') content += d.content;
        if (d.reasoning_content || d.content) opts.onProgress?.({ reasoning, content: content.length });
      };
      const type = res.headers?.get?.('content-type') || '';
      if (/application\/(?:[\w.+-]+\+)?json\b/i.test(type)) {
        let j;
        try {
          if (res.body) {
            const decoder = new TextDecoder(); let text = '';
            for await (const chunk of task.chunks(res.body)) text += decoder.decode(chunk, { stream: true });
            j = JSON.parse(text + decoder.decode());
          } else j = await res.json();
        } catch (e) { if (task.signal.aborted) throw e; throw fail('ai.invalidResponse'); }
        accept(j, true); complete = true;
      } else {
        if (!res.body) throw fail('ai.invalidResponse');
        let buffer = '', event = '', data = [];
        const decoder = new TextDecoder();
        const dispatch = () => {
          if (event === 'error') throw fail('ai.providerError');
          const payload = data.join('\n').trim(); data = []; event = '';
          if (!payload) return;
          if (payload === '[DONE]') { complete = true; done = true; return; }
          let j;
          try { j = JSON.parse(payload); } catch { throw fail('ai.invalidResponse'); }
          accept(j);
        };
        const line = (value) => {
          value = value.replace(/\r$/, '');
          if (!value) dispatch();
          else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
          else if (value.startsWith('event:')) event = value.slice(6).trim();
        };
        for await (const chunk of task.chunks(res.body)) {
          buffer += decoder.decode(chunk, { stream: true });
          let nl;
          while (!done && (nl = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, nl)); buffer = buffer.slice(nl + 1); }
          if (done) break;
        }
        if (!done) { buffer += decoder.decode(); if (buffer) line(buffer); dispatch(); }
      }
      if (!complete || /<think>(?:(?!<\/think>)[\s\S])*$/.test(content)) throw fail('ai.incomplete');
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!content) throw fail('ai.emptyAnswer');
      return content;
    });
  } catch (e) {
    if (e.aiResponse || e.code === 'ABORT_ERR' || e.code === 'TIMEOUT') throw e;
    // Nettfeil kan inneholde URL eller innsendte nøkler. Del bare en kjent feilkode.
    const code = e.cause?.code || e.code || '';
    throw new Error(t('ai.networkError', { name: r.name, code: /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'FETCH_FAILED' }));
  }
}

function gold(c) {
  const neg = c < 0; c = Math.abs(Math.round(c));
  const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), k = c % 100;
  const parts = [];
  if (g) parts.push(g + 'g');
  if (s || g) parts.push(s + 's');
  parts.push(k + 'c');
  return (neg ? '-' : '') + parts.join(' ');
}

// Komprimert tekstbilde av inventoryet som modellen får som kontekst.
function buildContext(data, maxRows = 60) {
  const lines = [];
  const coins = data.wallet?.find((w) => w.id === 1)?.value || 0;
  lines.push(`Konto: ${data.account?.name || '?'}. Gull i lommebok: ${gold(coins)}.`);
  const fs = data.freeSlots || {};
  const charFree = Object.entries(fs.characters || {}).map(([n, v]) => `${n} ${v.free}/${v.total}`).join(', ');
  lines.push(`Ledige plasser: bank ${fs.bank?.free ?? '?'}/${fs.bank?.total ?? '?'}; karakterer: ${charFree || 'ingen data'}.`);
  if (data.errors?.length) lines.push('Ufullstendig datagrunnlag: ' + data.errors.join('; ') + '. Ikke tolk manglende data som bekreftet fravær.');

  const totals = {};
  for (const r of data.rows) {
    totals[r.label] = totals[r.label] || { n: 0, v: 0 };
    totals[r.label].n += 1; totals[r.label].v += r.totalValue;
  }
  lines.push('Oppsummering per anbefaling: ' + Object.entries(totals).map(([k, v]) => `${k}: ${v.n} items (~${gold(v.v)})`).join('; ') + '.');
  const withFlag = (f) => data.rows.filter((r) => (r.flags || []).includes(f));
  const coll = withFlag('collection');
  if (coll.length) lines.push(`Fakta fra kontoen: ${coll.length} items teller i samlinger som ikke er fullført: ` + coll.slice(0, 15).map((r) => `${r.name} (${(r.collections || []).filter((c) => !c.has).map((c) => c.name).join(', ')})`).join('; ') + '.');
  const skins = withFlag('skinLocked');
  if (skins.length) lines.push(`Skinn som ikke er låst opp i garderoben: ` + skins.slice(0, 20).map((r) => r.name).join(', ') + '.');
  const dup = withFlag('unlockDup');
  if (dup.length) lines.push(`Opplåsninger kontoen allerede har (duplikater): ` + dup.slice(0, 15).map((r) => r.name).join(', ') + '.');

  const actionable = data.rows
    .filter((r) => !['stored', 'keep'].includes(r.action))
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, maxRows);
  lines.push('');
  lines.push(`De ${actionable.length} viktigste itemene (navn ×antall [rarity, hvor, binding] -> regelmotorens anbefaling ~verdi | vendor/TP/salvage per stk | begrunnelse):`);
  for (const r of actionable) {
    const loc = r.locations.map((l) => `${l.source}:${l.count}`).join(', ');
    lines.push(`- ${r.name} ×${r.count} [${r.rarity}, ${loc}${r.binding ? ', ' + r.binding + '-bundet' : ''}] -> ${r.label} ~${gold(r.totalValue)} | ${gold(r.vendor)}/${gold(r.tpList)}/${gold(r.salvage)} | ${r.reason}`);
  }
  const keep = data.rows.filter((r) => r.action === 'keep').slice(0, 25).map((r) => `${r.name} ×${r.count}`);
  if (keep.length) lines.push('', 'Merket behold: ' + keep.join(', '));
  return lines.join('\n');
}

// Språket modellen skal svare på, styrt av valgt UI-språk
function answerLanguage() { return t('ai.language'); }

const SYSTEM = () => `Du er en erfaren Guild Wars 2-spiller som hjelper med å rydde inventory. Du får et utdrag av spillerens inventory med ferdig utregnede verdier (kobber: 10000c = 1g) og en regelbasert anbefaling per item. Tallene er fasit for verdi, du skal ikke regne dem på nytt. Din jobb er å prioritere, forklare og fange opp ting reglene ikke ser: items som brukes i kjente samlinger, legendary-crafting, populære oppskrifter, eller som er dumme å selge nå. Svar alltid på ${answerLanguage()}, kort og konkret. Bruk itemnavnene slik de står.`;

const PLAN_SCHEMA = {
  name: 'oppryddingsplan',
  schema: {
    type: 'object',
    properties: {
      oppsummering: { type: 'string' },
      steg: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            prioritet: { type: 'integer' },
            hva: { type: 'string' },
            handling: { type: 'string' },
            hvorfor: { type: 'string' },
          },
          required: ['prioritet', 'hva', 'handling', 'hvorfor'],
          additionalProperties: false,
        },
      },
      advarsler: { type: 'array', items: { type: 'string' } },
    },
    required: ['oppsummering', 'steg', 'advarsler'],
    additionalProperties: false,
  },
};

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* prøv å finne objektet */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* gi opp */ } }
  throw new Error(t('ai.invalidResponse'));
}

async function prioritize(cfg, data, opts = {}) {
  const ctx = buildContext(data);
  const messages = [
    { role: 'system', content: SYSTEM() },
    { role: 'user', content: `${ctx}\n\nLag en prioritert oppryddingsplan med 5 til 12 steg. Start med det som frigjør mest plass eller gir mest gull for minst innsats. Nevn eksplisitt hvis noe i lista bør beholdes selv om regelmotoren sier selg, og hvorfor. Svar som JSON, med tekstene på ${answerLanguage()}.` },
  ];
  const text = await complete(cfg, messages, { ...opts, jsonSchema: PLAN_SCHEMA, maxTokens: 8000 });
  return parseJson(text);
}

async function chat(cfg, data, history, opts = {}) {
  const ctx = buildContext(data, 80);
  const messages = [
    { role: 'system', content: SYSTEM() + '\n\nSpillerens inventory:\n' + ctx },
    ...history.slice(-10),
  ];
  return complete(cfg, messages, { ...opts, maxTokens: 4000 });
}

module.exports = { listModels, describe, prioritize, chat, buildContext, answerLanguage, completeText: (cfg, messages, opts = {}) => complete(cfg, messages, { maxTokens: 4000, ...opts }) };
