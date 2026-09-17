'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),path=require('node:path'),{pathToFileURL}=require('node:url');
const load=require('./helpers/load-main');
function harness(testMode=false){
  const handlers=new Map(),calls=[],jobs=[];
  const config={apiKey:'',wheel:{locked:false},panel:{},rotations:{}};
  const ipc=load('src/ipc.js',{
    electron:{app:{getPath:()=>path.join(__dirname,'fake-profile')},ipcMain:{handle:(c,fn)=>handlers.set(c,fn)},shell:{openExternal:async()=>{throw Error('external-failed');}},clipboard:{writeText:()=>calls.push('clipboard')}},
    './config':{TEST_MODE:testMode,DEMO:testMode,config,publicConfig:()=>config,applyPatch:p=>Object.assign(config,p),saveConfig:()=>false,lastSaveError:'DISK_FULL'},
    './windows':{broadcast(){},openModule(){},applyConfig(){calls.push('apply');}},
    './modules/inventory':{prioritize:(_c,opts)=>new Promise((resolve,reject)=>{jobs.push({opts,resolve});opts.onProgress({content:1});opts.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});})},
    './mumble':{state:{running:false}},'./modules/arcdps':{install:()=>calls.push('install')},
    './modules/dps':{listLogs:async dir=>{calls.push(dir);return[];}},'./log':{error(){},warn(){}}
  });ipc.register();
  const event=id=>{const sender=new EventEmitter();sender.id=id;sender.mainFrame={url:pathToFileURL(path.resolve(__dirname,'../src/renderer/panel.html')).href};sender.isDestroyed=()=>false;sender.send=(c,p)=>calls.push({c,p});return {sender,senderFrame:sender.mainFrame};};
  return {handlers,calls,jobs,event};
}
test('IPC avviser fremmed avsender og testmodus-sideeffekter før modulkallet',async()=>{
  const h=harness(true),e=h.event(1);e.senderFrame={url:'https://example.invalid'};
  await assert.rejects(h.handlers.get('config:get')(e));assert.equal(h.calls.length,0);
  await assert.rejects(h.handlers.get('arc:install')(h.event(1)));assert.equal(h.calls.length,0);
  const listed=await h.handlers.get('dps:list')(h.event(1));assert.ok(listed.dir.endsWith('evtc-test'));
});
test('avbrytelse er avgrenset til avsender og forespørsel; progress merkes og listeners ryddes',async()=>{
  const h=harness(),a=h.event(1),b=h.event(2);
  const one=h.handlers.get('ai:prioritize')(a,{requestId:'one'}),two=h.handlers.get('ai:prioritize')(a,{requestId:'two'});
  assert.equal(await h.handlers.get('ai:cancel')(b,'one'),false);
  assert.equal(await h.handlers.get('ai:cancel')(a,'one'),true);await assert.rejects(one,/cancelled/);
  assert.equal(h.jobs[1].opts.signal.aborted,false);h.jobs[1].resolve('result');assert.equal(await two,'result');
  assert.deepEqual(h.calls.filter(c=>c.p).map(c=>c.p.requestId),['one','two']);assert.equal(a.sender.listenerCount('destroyed'),0);
});
test('lagringsfeil/ekstern åpning avvises, og chat uten spill endrer ikke utklippstavlen',async()=>{
  const h=harness(),e=h.event(1);
  await assert.rejects(h.handlers.get('config:set')(e,{apiKey:''}),/DISK_FULL/);
  await assert.rejects(h.handlers.get('open:url')(e,'https://example.invalid'),/external-failed/);
  assert.equal(await h.handlers.get('open:url')(e,'file:///fake'),false);
  assert.equal((await h.handlers.get('game:paste')(e,'hello')).reason,'NOGAME');assert.ok(!h.calls.includes('clipboard'));
});
