'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'config:get', 'config:set', 'i18n:get',
  'inv:refresh', 'ai:models', 'ai:providers', 'ai:prioritize', 'ai:chat',
  'timers:data', 'gw2:maps', 'mumble:get', 'daily:get',
  'dps:list', 'dps:parse', 'dps:upload',
  'tp:get', 'chars:get', 'chars:review', 'guild:get',
  'wheel:ignoreMouse', 'win:drag', 'app:setStartup',
  'arc:status', 'arc:install', 'arc:uninstall', 'arc:installBridge', 'gw2:detectDir', 'gw2:pickDir',
  'live:get', 'live:record', 'live:resetSession', 'overlays:get', 'overlays:set', 'overlays:ignoreMouse', 'skills:get', 'skills:setRotation', 'skills:suggest', 'skills:icons',
  'clipboard:write', 'game:paste', 'open:wiki', 'open:url',
  'panel:open', 'panel:show', 'panel:close', 'panel:state', 'wheel:setLocked', 'app:quit', 'app:hide',
  'log:open', 'log:report',
  'setup:check', 'setup:installArc', 'setup:done',
  'update:check', 'update:install',
]);
const EVENTS = new Set([
  'ai:progress', 'mumble:state', 'dps:new', 'panel:module', 'panel:visible', 'wheel:locked', 'config:changed', 'live:state', 'skills:changed', 'overlays:changed',
  'update:status',
]);

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => {
    if (!INVOKE.has(channel)) return Promise.reject(new Error('Ukjent kanal ' + channel));
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) throw new Error('Ukjent hendelse ' + channel);
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
