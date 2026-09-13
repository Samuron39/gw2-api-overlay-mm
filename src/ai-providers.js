'use strict';
// AI-leverandører. Alle snakker OpenAI-formatet (chat completions med strømming), så klienten i ai.js er felles;
// det som skiller dem er adresse, nøkkel, standardmodell og noen små avvik i hva de godtar i forespørselen.
// Lokal LM Studio er standard og eneste som ikke sender data ut av maskinen.

const PROVIDERS = {
  local: {
    name: 'LM Studio (lokal)', needsKey: false, free: true,
    url: '', // fra config.lmUrl
    defaultModel: '', // fra config.lmModel
    json: 'schema', // response_format: json_schema
  },
  gemini: {
    name: 'Google Gemini', needsKey: true, free: true,
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-flash',
    json: 'schema',
  },
  openai: {
    name: 'OpenAI', needsKey: true, free: false,
    url: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-5-mini',
    json: 'schema',
    noTemperature: true, // gpt-5-familien godtar bare standard temperatur
    maxTokensField: 'max_completion_tokens', // nyere OpenAI-modeller avviser max_tokens
  },
  anthropic: {
    name: 'Anthropic Claude', needsKey: true, free: false,
    url: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-sonnet-5',
    json: 'none', // OpenAI-kompatibilitetslaget støtter ikke response_format, vi ber om JSON i prompten
    extraHeaders: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
  deepseek: {
    name: 'DeepSeek', needsKey: true, free: false,
    url: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek-chat',
    json: 'object', // bare response_format: json_object
  },
  xai: {
    name: 'xAI Grok', needsKey: true, free: false,
    url: 'https://api.x.ai/v1',
    keyUrl: 'https://console.x.ai',
    defaultModel: 'grok-4-fast',
    json: 'schema',
  },
  custom: {
    name: 'Egendefinert (OpenAI-kompatibel)', needsKey: false, free: false,
    url: '', // fra config.aiProviders.custom.url
    defaultModel: '',
    json: 'object',
  },
};
const ORDER = ['local', 'gemini', 'openai', 'anthropic', 'deepseek', 'xai', 'custom'];

// Metadata til renderer (uten funksjoner)
function list() {
  return ORDER.map((id) => { const p = PROVIDERS[id]; return { id, name: p.name, needsKey: p.needsKey, free: p.free, url: p.url, keyUrl: p.keyUrl || '', defaultModel: p.defaultModel }; });
}

// Løs opp hva som faktisk skal brukes ut fra konfigen: adresse, nøkkel og modell for valgt leverandør
function resolve(cfg) {
  const id = PROVIDERS[cfg.aiProvider] ? cfg.aiProvider : 'local';
  const p = PROVIDERS[id];
  const saved = (cfg.aiProviders && cfg.aiProviders[id]) || {};
  let url, model;
  if (id === 'local') { url = cfg.lmUrl || 'http://localhost:1234/v1'; model = cfg.lmModel || ''; }
  else if (id === 'custom') { url = saved.url || ''; model = saved.model || ''; }
  else { url = p.url; model = saved.model || p.defaultModel; }
  return { id, name: p.name, url: String(url || '').replace(/\/+$/, ''), apiKey: saved.apiKey || '', model, json: p.json, needsKey: p.needsKey, noTemperature: !!p.noTemperature, maxTokensField: p.maxTokensField || 'max_tokens', extraHeaders: p.extraHeaders };
}

function headers(r) {
  const h = { 'Content-Type': 'application/json' };
  if (r.apiKey) { h.Authorization = 'Bearer ' + r.apiKey; if (r.extraHeaders) Object.assign(h, r.extraHeaders(r.apiKey)); }
  return h;
}

// Forespørselskroppen for chat/completions, tilpasset leverandørens avvik. Ren funksjon, testes i test/ai-providers.test.js.
function buildBody(r, messages, opts = {}) {
  const body = { model: r.model || undefined, messages, stream: true };
  if (!r.noTemperature) body.temperature = opts.temperature ?? 0.3;
  body[r.maxTokensField] = opts.maxTokens ?? 4000;
  if (opts.jsonSchema) {
    if (r.json === 'schema') body.response_format = { type: 'json_schema', json_schema: { name: opts.jsonSchema.name, strict: true, schema: opts.jsonSchema.schema } };
    else if (r.json === 'object') body.response_format = { type: 'json_object' };
  }
  return body;
}

// Modell-id-er fra /models: Gemini returnerer "models/gemini-…", andre bare navnet
function parseModels(json) {
  return (json.data || []).map((m) => String(m.id || '').replace(/^models\//, '')).filter((id) => id && !id.includes('embed'));
}

module.exports = { PROVIDERS, ORDER, list, resolve, headers, buildBody, parseModels };
