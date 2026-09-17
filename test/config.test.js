'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cfg = require('../src/config');
test('ett skadet leverandørfelt eller bygg tar ikke med seg gyldige naboer', () => {
  const {normalize,rotation}=require('../src/config-validation');
  const result=normalize({aiProviders:{openai:{apiKey:'FAKE-PRESERVED',model:'model'},custom:{apiKey:'FAKE-CUSTOM',model:42}},rotations:{good:[{skill:1,note:'ok'}],bad:{steps:'broken'}}},{aiProviders:{},rotations:{}});
  assert.equal(result.config.aiProviders.openai.apiKey,'FAKE-PRESERVED');
  assert.equal(result.config.aiProviders.custom.apiKey,'FAKE-CUSTOM');assert.equal(result.config.aiProviders.custom.model,undefined);
  assert.equal(result.config.rotations.good.steps[0].skill,1);assert.equal(result.config.rotations.bad,undefined);
  assert.equal(result.invalid.length,2);assert.throws(()=>rotation({steps:'broken'}));assert.throws(()=>rotation({steps:[{skill:'1'}]}));
});
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-config-test-'));
  t.after(() => { cfg.flush(); fs.rmSync(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'config.json'); cfg.init({ path: file, systemLocale: 'nb-NO' });
  return { dir, file };
}
test('skadet JSON bevares byte for byte før ny konfig lagres', (t) => {
  const { file } = temp(t), original = Buffer.from('{"apiKey":"FAKE-CONFIG-TOKEN",');
  fs.writeFileSync(file, original); cfg.loadConfig();
  assert.ok(cfg.publicConfig().lastSaveError);
  assert.deepEqual(fs.readFileSync(cfg.publicConfig().recoveryFile), original);
  assert.deepEqual(fs.readFileSync(file), original);
  assert.equal(cfg.saveConfig(), true);
  assert.equal(JSON.parse(fs.readFileSync(file)).wheel.size, 200);
});
test('mislykket backup blokkerer automatisk overskriving', (t) => {
  const { file } = temp(t); fs.writeFileSync(file, '{broken');
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (target, ...args) => { if (String(target).includes('.broken-')) throw Object.assign(new Error('DISK'), {code:'ENOSPC'}); return write(target, ...args); });
  cfg.loadConfig(); assert.equal(cfg.saveConfig(), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  assert.match(cfg.lastSaveError, /ENOSPC/);
});
test('rename-feil bevarer originalen og setter lagringsfeil', (t) => {
  const { file } = temp(t); fs.writeFileSync(file, '{"wheel":{"size":240}}'); cfg.loadConfig();
  cfg.applyPatch({ wheel: { size: 280 } });
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('LOCKED'), {code:'EPERM'}); });
  assert.equal(cfg.saveConfig(), false);
  assert.equal(JSON.parse(fs.readFileSync(file)).wheel.size, 240);
  assert.match(cfg.lastSaveError, /EPERM/);
});
test('lesefeil gir aldri standardkonfig over eksisterende fil', (t) => {
  const { file } = temp(t); fs.writeFileSync(file, '{"wheel":{"size":240}}');
  const read = fs.readFileSync;
  const mock = t.mock.method(fs, 'readFileSync', (target, ...args) => { if (target===file) throw Object.assign(new Error('DENIED'), {code:'EACCES'}); return read(target,...args); });
  cfg.loadConfig(); assert.equal(cfg.saveConfig(), false); mock.mock.restore();
  assert.equal(JSON.parse(fs.readFileSync(file)).wheel.size, 240);
});
test('gamle gyldige innstillinger bevares og ugyldige felt normaliseres', (t) => {
  const { file } = temp(t);
  fs.writeFileSync(file, JSON.stringify({ wheel: {x: -800, size: 260}, panel: {width: 'x', height: 700}, keepList: null, apiKey: 'FAKE-UNCHANGED' }));
  cfg.loadConfig(); assert.equal(cfg.config.wheel.x,-800); assert.equal(cfg.config.panel.height,700);
  assert.equal(cfg.config.panel.width,1000); assert.ok(Array.isArray(cfg.config.keepList));
  assert.equal(cfg.config.apiKey,'FAKE-UNCHANGED'); assert.ok(cfg.publicConfig().recoveryFile);
  assert.throws(()=>cfg.applyPatch({wheel:{size:NaN}}));
  assert.throws(()=>cfg.applyPatch({unknown:true}));
  assert.throws(()=>cfg.applyPatch(JSON.parse('{"__proto__":{"polluted":true}}')));
  cfg.applyPatch({overlays:{buffs:{layout:'list',mode:'clock'}},wheel:{size:300}});
  assert.equal(cfg.config.wheel.x,-800); assert.equal(cfg.config.overlays.buffs.mode,'clock');
});
test('manglende fil gir ferske defaults uten delt muterbar tilstand', (t) => {
  temp(t); cfg.loadConfig(); cfg.config.keepList.push('test'); cfg.config.wheel.size=300;
  cfg.loadConfig(); assert.equal(cfg.config.wheel.size,200); assert.ok(!cfg.config.keepList.includes('test'));
  assert.equal(cfg.publicConfig().lastSaveError,'');
});
