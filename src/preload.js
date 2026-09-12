'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'config:get', 'config:set',
  'inv:refresh', 'ai:models', 'ai:prioritize', 'ai:chat',
  'timers:data', 'gw2:maps', 'mumble:get', 'daily:get',
  'dps:list', 'dps:parse', 'dps:upload',
  'tp:get', 'chars:get', 'chars:review', 'guild:get',
  'wheel:ignoreMouse', 'app:setStartup',
  'arc:status', 'arc:install', 'arc:uninstall', 'arc:installBridge', 'gw2:detectDir', 'gw2:pickDir',
  'live:get', 'overlays:get', 'overlays:set', 'skills:get', 'skills:setRotation', 'skills:suggest',
  'clipboard:write', 'game:paste', 'open:wiki', 'open:url',
  'panel:open', 'panel:show', 'panel:close', 'panel:state', 'wheel:setLocked', 'app:quit',
  'log:open', 'log:report',
]);
const EVENTS = new Set(['ai:progress', 'mumble:state', 'dps:new', 'panel:module', 'panel:visible', 'wheel:locked', 'config:changed', 'live:state', 'skills:changed', 'overlays:changed']);

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
