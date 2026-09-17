'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const load = require('./helpers/load-main');
const { visibility, clamp } = require('../src/window-state');
class Window extends EventEmitter {
  constructor(opts) { super(); this.bounds = { x: 0, y: 0, ...opts }; this.visible = opts.show !== false; this.webContents = new EventEmitter(); this.webContents.send = () => {}; this.webContents.setZoomFactor = () => {}; }
  getBounds() { return this.bounds; } setBounds(b) { this.bounds = { ...this.bounds, ...b }; }
  getPosition() { return [this.bounds.x, this.bounds.y]; } setPosition(x,y) { this.setBounds({x,y}); }
  isDestroyed() { return false; } isVisible() { return this.visible; } isFocused() { return false; }
  hide() { this.visible = false; } showInactive() { this.visible = true; } show() { this.visible = true; } focus() { this.focused = true; }
  loadFile() {} setIgnoreMouseEvents() {} setResizable() {} setOpacity() {} setAlwaysOnTop() {} setMenuBarVisibility() {}
  setMinimumSize(w,h) { this.min = [w,h]; } setMaximumSize(w,h) { this.max = [w,h]; }
}
const screen = { getPrimaryDisplay: () => ({workArea:{x:0,y:0,width:1920,height:1080}}), getDisplayNearestPoint: () => ({workArea:{x:0,y:0,width:1920,height:1080}}) };
test('synlighet bevarer manuelt skjul og opphever bare aktiv skjulegrunn', () => {
  const base = { wheelWanted:true,panelWanted:true,followGame:true,gameRunning:true,autoHidden:false,manuallyHidden:false };
  assert.deepEqual(visibility(base),{wheel:true,panel:true,overlays:true});
  assert.deepEqual(visibility({...base,autoHidden:true}),{wheel:false,panel:false,overlays:false});
  assert.deepEqual(visibility({...base,gameRunning:false}),{wheel:false,panel:true,overlays:false});
  assert.deepEqual(visibility({...base,gameRunning:false,followGame:false}),{wheel:true,panel:true,overlays:true});
  assert.equal(visibility({...base,gameRunning:false,wheelForced:true}).wheel,true);
  assert.deepEqual(visibility({...base,wheelWanted:false,panelWanted:false,manuallyHidden:true}),{wheel:false,panel:false,overlays:false});
});
test('clamp håndterer negative skjermer og vinduer større enn arbeidsområdet', () => {
  assert.deepEqual(clamp(9999,9999,400,200,{x:-1920,y:-200,width:1920,height:1080}),{x:-400,y:680});
  assert.deepEqual(clamp(9999,9999,3000,2000,{x:-1920,y:0,width:1920,height:1080}),{x:-1920,y:0});
});
test('reset flytter eksisterende overlay og lagrer faktiske koordinater; ugyldig patch avvises', () => {
  const overlay = load('src/overlays.js', { electron:{BrowserWindow:Window,screen} });
  const config = {overlays:{dps:{enabled:true,x:9999,y:9999}}}; let saves=0;
  overlay.init({config,webPreferences:{},saveSoon:()=>saves++});
  const w=overlay.get('dps'); assert.equal(w.getBounds().x,1620);
  const result=overlay.set('dps',{x:null,y:null});
  assert.equal(overlay.get('dps'),w); assert.equal(w.getBounds().x,810);
  assert.equal(result.x,810); assert.equal(config.overlays.dps.x,810); assert.ok(saves>=2);
  assert.throws(()=>overlay.set('dps',{opacity:NaN})); assert.throws(()=>overlay.set('dps',{filter:'bogus'}));
});
test('hjulstørrelse går opp og ned uten omstart; testmodus starter ingen spillpolling', async () => {
  const config={wheel:{size:200,x:0,y:0},panel:{width:600,height:700},uiScale:1};
  const cfg={config,TEST_MODE:true,saveSoon(){},publicConfig:()=>config};
  const w=load('src/windows.js', {electron:{BrowserWindow:Window,screen},'./config':cfg,'./overlays':{setZoom(){},setSuspended(){}},'./modules/arcdps':{gameRunning(){throw Error('production poll');}}});
  w.createWheel(); let prev=structuredClone(config);config.wheel.size=280;w.applyConfig(prev);
  assert.equal(w.wheelWin.getBounds().width,280);assert.deepEqual(Array.from(w.wheelWin.min),[280,314]);
  prev=structuredClone(config);config.wheel.size=160;w.applyConfig(prev);
  assert.equal(w.wheelWin.getBounds().width,160);assert.deepEqual(Array.from(w.wheelWin.max),[160,194]);
  w.wheelWin.setPosition(1800,1000);config.wheel.size=320;config.uiScale=2.5;w.applyScale();
  const b=w.wheelWin.getBounds();assert.ok(b.x+b.width<=1920);assert.ok(b.y+b.height<=1080);
  await w.startFollowGame();
  w.createPanel();w.panelWin.webContents.emit('did-finish-load');
  await w.openModule('settings',{toggle:false,inactive:true});assert.equal(w.panelWin.focused,undefined);
  await w.openModule('settings',{toggle:false});assert.equal(w.panelWin.focused,true);
});
test('updater-snapshot er kopi med stigende revisjon, også etter nedlasting', () => {
  const autoUpdater=new EventEmitter();autoUpdater.checkForUpdates=async()=>{};
  const updater=load('src/updater.js',{'electron-updater':{autoUpdater}}, {setTimeout:()=>({unref(){}}),setInterval:()=>({unref(){}})});
  updater.init({app:{isPackaged:true,getVersion:()=> '0.4.4'},config:{}});
  const first=updater.getState();autoUpdater.emit('update-downloaded',{version:'0.5.0'});
  const last=updater.getState();assert.ok(last.revision>first.revision);assert.equal(last.status,'downloaded');
  last.status='oops';assert.equal(updater.getState().status,'downloaded');
});
