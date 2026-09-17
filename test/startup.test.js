'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const load=require('./helpers/load-main');
function startup({testMode=true,canStart=true}={}){
  const calls=[],events=new Map();let ready;
  const record=name=>(...args)=>{calls.push([name,...args]);};
  const app={setName(){},on:(name,fn)=>events.set(name,fn),quit:record('quit'),getPath:()=> 'isolated-profile',getVersion:()=> 'test',getLocale:()=> 'nb',whenReady:()=>({then:fn=>{ready=fn();}})};
  const cfg={DEMO:testMode,TEST_MODE:testMode,config:{overlays:{},setupDone:true,apiKey:'fake',gw2Dir:'fake'},init:record('cfg.init'),loadConfig(){},flush:record('cfg.flush')};
  const win=Object.fromEntries(['createWheel','createPanel','setupAutoHide','startDpsWatch','createTray','startFollowGame','setQuitting','stop','showWheel','openModule','broadcast','showBalloon'].map(k=>[k,record(k)]));
  const mumble=new EventEmitter();mumble.start=record('mumble.start');mumble.stop=record('mumble.stop');mumble.state={};
  const live=new EventEmitter();live.start=record('live.start');live.stop=record('live.stop');
  load('src/main.js',{
    electron:{app,globalShortcut:{register:record('shortcut'),unregisterAll:record('shortcut.clear')}},
    './runtime':{prepare:()=>canStart},'./config':cfg,'./windows':win,'./ipc':{register:record('ipc.register')},
    './gw2':{init:record('gw2.init'),flushCache:async()=>{calls.push(['cache.flush']);}},
    './modules/dps':{dispose:async()=>{calls.push(['dps.dispose']);}},'./modules/arcdps':{},'./live':live,'./mumble':mumble,
    './overlays':{init:record('overlays.init'),broadcast(){}},'./updater':{init:record('updater.init')},
    './log':{init(){},info(){},error(){},warn(){}},'./modules/guides':{init:record('guides.init')},
  },{process:{on(){},env:{},versions:{},getSystemVersion:()=> 'mock'}});
  return {calls,events,ready};
}
test('demo oppstarter bare isolerte tjenester og flusher før avslutning',async()=>{
  const h=startup();await h.ready;
  const names=h.calls.map(c=>c[0]);
  for(const forbidden of ['mumble.start','live.start','startDpsWatch','createTray','shortcut'])assert.ok(!names.includes(forbidden),forbidden);
  assert.equal(h.calls.find(c=>c[0]==='overlays.init')[1].testMode,true);
  assert.equal(h.calls.find(c=>c[0]==='updater.init')[1].testMode,true);
  h.events.get('before-quit')({preventDefault(){}});assert.ok(!h.calls.some(c=>c[0]==='quit'));
  await new Promise(setImmediate);assert.equal(h.calls.at(-1)[0],'quit');
  assert.ok(h.calls.some(c=>c[0]==='cache.flush'));assert.ok(h.calls.some(c=>c[0]==='dps.dispose'));
});
test('avvist instanslås fortsetter aldri oppstart; andre instans åpner eksisterende panel',async()=>{
  const blocked=startup({testMode:false,canStart:false});
  assert.deepEqual(blocked.calls.map(c=>c[0]),['quit']);assert.equal(blocked.ready,undefined);
  const h=startup();await h.ready;h.events.get('second-instance')();
  assert.equal(h.calls.at(-2)[0],'showWheel');assert.equal(h.calls.at(-1)[0],'openModule');assert.equal(h.calls.at(-1)[2].toggle,false);
});
