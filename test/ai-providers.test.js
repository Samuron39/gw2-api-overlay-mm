'use strict';
// Tester for src/ai-providers.js: oppløsning av leverandør fra konfig, headere og forespørselskropp per leverandør.
const test = require('node:test');
const assert = require('node:assert/strict');
const providers = require('../src/ai-providers');

test('lokal er standard og bruker lmUrl/lmModel uten nøkkel', () => {
  const r = providers.resolve({ lmUrl: 'http://localhost:1234/v1/', lmModel: 'gemma' });
  assert.equal(r.id, 'local'); assert.equal(r.url, 'http://localhost:1234/v1'); assert.equal(r.model, 'gemma');
  assert.equal(r.needsKey, false); assert.equal(providers.headers(r).Authorization, undefined);
});

test('ukjent leverandør faller tilbake til lokal', () => {
  assert.equal(providers.resolve({ aiProvider: 'tull' }).id, 'local');
});

test('Gemini bruker fast adresse, standardmodell og Bearer-nøkkel', () => {
  const r = providers.resolve({ aiProvider: 'gemini', aiProviders: { gemini: { apiKey: 'k1' } } });
  assert.match(r.url, /generativelanguage\.googleapis\.com/); assert.equal(r.model, 'gemini-2.5-flash');
  assert.equal(providers.headers(r).Authorization, 'Bearer k1');
  const body = providers.buildBody(r, [{ role: 'user', content: 'hei' }], { jsonSchema: { name: 'x', schema: { type: 'object' } }, maxTokens: 500 });
  assert.equal(body.response_format.type, 'json_schema'); assert.equal(body.max_tokens, 500); assert.equal(body.temperature, 0.3); assert.equal(body.stream, true);
});

test('OpenAI sender max_completion_tokens og ingen temperatur', () => {
  const r = providers.resolve({ aiProvider: 'openai', aiProviders: { openai: { apiKey: 'k', model: 'gpt-5' } } });
  const body = providers.buildBody(r, [], { maxTokens: 800 });
  assert.equal(body.max_completion_tokens, 800); assert.equal('max_tokens' in body, false); assert.equal('temperature' in body, false); assert.equal(body.model, 'gpt-5');
});

test('Anthropic får egne headere og ber ikke om response_format', () => {
  const r = providers.resolve({ aiProvider: 'anthropic', aiProviders: { anthropic: { apiKey: 'ak' } } });
  const h = providers.headers(r);
  assert.equal(h['x-api-key'], 'ak'); assert.ok(h['anthropic-version']);
  assert.equal('response_format' in providers.buildBody(r, [], { jsonSchema: { name: 'x', schema: {} } }), false);
});

test('DeepSeek bruker json_object i stedet for json_schema', () => {
  const r = providers.resolve({ aiProvider: 'deepseek', aiProviders: { deepseek: { apiKey: 'd' } } });
  assert.deepEqual(providers.buildBody(r, [], { jsonSchema: { name: 'x', schema: {} } }).response_format, { type: 'json_object' });
});

test('egendefinert bruker lagret adresse og modell, nøkkel valgfri', () => {
  const r = providers.resolve({ aiProvider: 'custom', aiProviders: { custom: { url: 'http://ollama:11434/v1/', model: 'llama' } } });
  assert.equal(r.url, 'http://ollama:11434/v1'); assert.equal(r.model, 'llama'); assert.equal(r.needsKey, false);
});

test('parseModels fjerner models/-prefiks og embed-modeller', () => {
  assert.deepEqual(providers.parseModels({ data: [{ id: 'models/gemini-2.5-flash' }, { id: 'text-embedding-004' }, { id: 'gpt-5-mini' }] }), ['gemini-2.5-flash', 'gpt-5-mini']);
});

test('list() gir metadata uten funksjoner, lokal først', () => {
  const l = providers.list();
  assert.equal(l[0].id, 'local'); assert.ok(l.find((p) => p.id === 'gemini').free);
  for (const p of l) for (const v of Object.values(p)) assert.notEqual(typeof v, 'function');
});
