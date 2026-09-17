'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function loadCharacters(completeText) {
  const module = { exports: {} }, nativeRequire = createRequire(path.resolve('src/modules/characters.js'));
  const gw2 = { get: async () => [{ name: 'Alfa', profession: 'Guardian', level: 1, equipment: [] }], fetchItems: async () => new Map() };
  const ai = { answerLanguage: () => 'norsk', completeText };
  vm.runInNewContext(fs.readFileSync('src/modules/characters.js', 'utf8'), { module, exports: module.exports, require: name => name === '../gw2' ? gw2 : name === '../ai' ? ai : nativeRequire(name) });
  return module.exports;
}

test('karaktervurdering avventer async logger og videresender avbrytelse/fremdrift', async () => {
  const options = { signal: new AbortController().signal, onProgress: () => {} };
  let context;
  const characters = loadCharacters(async (_config, messages, opts) => { assert.equal(opts, options); context = messages[1].content; return 'Vurdering'; });
  const dps = {
    listLogs: async (_dir, limit, opts) => { assert.equal(limit, 30); assert.equal(opts, options); return [{ file: 'fight.evtc' }]; },
    parseLog: async (_file, opts) => { assert.equal(opts, options); return { boss: 'Golem', durationMs: 10000, players: [{ name: 'Alfa', dpsTarget: 2300, spec: 'Guardian' }] }; },
  };
  assert.equal(await characters.review({ apiKey: 'fake-key' }, 'Alfa', dps, 'logs', options), 'Vurdering');
  assert.match(context, /Golem/); assert.match(context, /2300/);
});

test('avbrutt loggsøk starter ikke AI-generering', async () => {
  const controller = new AbortController(); let generated = false;
  const characters = loadCharacters(async () => { generated = true; });
  const dps = { listLogs: async () => { controller.abort(); controller.signal.throwIfAborted(); } };
  await assert.rejects(characters.review({ apiKey: 'fake-key' }, 'Alfa', dps, 'logs', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(generated, false);
});
