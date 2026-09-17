'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {pathToFileURL}=require('node:url');
const secrets=require('../src/secrets'), security=require('../src/security'), runtime=require('../src/runtime');
test('nøkler renses før konsoll/fillogg og også ved nøkkelbytte', (t)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gw2-secrets-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const lines=[];t.mock.method(console,'error',line=>lines.push(line));
  const log=require('../src/log');log.init({getPath:()=>dir});
  const old='FAKE-OLD-SECRET', fresh='FAKE-NEW-SECRET';
  secrets.rememberConfig({apiKey:old,aiProviders:{custom:{apiKey:'FAKE-AI/KEY'}}});
  secrets.rememberConfig({apiKey:fresh});
  log.error('test',`401 ${old} ${fresh} FAKE-AI%2FKEY`,{password:'FAKE-OBJECT-SECRET'});
  const all=lines.join('\n')+fs.readFileSync(log.file(),'utf8');
  for(const value of [old,fresh,'FAKE-AI%2FKEY','FAKE-OBJECT-SECRET']) assert.ok(!all.includes(value));
  fs.appendFileSync(log.file(),`legacy ${old}\n`);
  assert.ok(!log.tail().join('\n').includes(old));
  assert.match(all,/401/);assert.match(all,/REDACTED/);
  assert.ok(!secrets.redact('https://example.invalid/v1?key=FAKE_URL_CREDENTIAL').includes('FAKE_URL_CREDENTIAL'));
  secrets.rememberConfig({lmUrl:'https://example.invalid/v1?key=FAKE_URL_CREDENTIAL'});
  assert.ok(!secrets.redact('error FAKE_URL_CREDENTIAL').includes('FAKE_URL_CREDENTIAL'));
});
test('kun lokale hovedrammer fra kjente sider får IPC', ()=>{
  const frame={url:pathToFileURL(path.resolve('src/renderer/panel.html')).href};
  const event={senderFrame:frame,sender:{mainFrame:frame}};
  assert.equal(security.trustedSender(event),true);
  assert.equal(security.trustedSender({...event,senderFrame:{...frame}}),false);
  frame.url='https://example.com/panel.html';assert.equal(security.trustedSender(event),false);
});
test('DPS-fil må ligge i valgt mappe, også etter reelle filoppslag', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gw2-path-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const root=path.join(dir,'logs');fs.mkdirSync(root);
  const inside=path.join(root,'one.evtc'), outside=path.join(dir,'two.evtc');
  fs.writeFileSync(inside,'EVTC');fs.writeFileSync(outside,'EVTC');
  assert.equal(security.logFile(root,inside),fs.realpathSync(inside));
  assert.throws(()=>security.logFile(root,outside));
  assert.throws(()=>security.logFile(root,path.join(root,'..','two.evtc')));
  const link=path.join(root,'escape');fs.symlinkSync(dir,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>security.logFile(root,path.join(link,'two.evtc')));
  fs.unlinkSync(link); // ingen rekursiv sletting gjennom junction
});
test('demo velger unik temp-profil uten å kontakte produksjonens instanslås', t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gw2-runtime-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let locks=0; const profiles=[];
  const app={getPath:()=>dir,setPath:(key,value)=>{assert.ok(fs.statSync(value).isDirectory());if(key==='userData') profiles.push(value);},requestSingleInstanceLock:()=>{locks++;return false;}};
  assert.equal(runtime.prepare(app,true),true);assert.equal(runtime.prepare(app,true),true);
  assert.equal(locks,0);assert.notEqual(profiles[0],profiles[1]);
  assert.ok(profiles.every(p=>p.startsWith(dir+path.sep)));
  assert.equal(runtime.prepare(app,false),false);assert.equal(locks,1);
});
test('IPC-allowlisten samsvarer med alle registrerte handlere', ()=>{
  const ipc=fs.readFileSync(path.join(__dirname,'../src/ipc.js'),'utf8');
  const preload=fs.readFileSync(path.join(__dirname,'../src/preload.js'),'utf8').split('const INVOKE')[1].split(']);')[0];
  assert.deepEqual([...ipc.matchAll(/handle\('([^']+)'/g)].map(m=>m[1]).sort(),[...preload.matchAll(/'([^']+)'/g)].map(m=>m[1]).sort());
});
