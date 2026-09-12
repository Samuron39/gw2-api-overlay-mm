'use strict';
// Panel-ramme: modulregister, faner, felles hjelpefunksjoner.
const Panel = (() => {
  const modules = {};
  const order = [];
  let current = null;
  let config = null;
  const listeners = { config: [] };

  const $ = (sel, root = document) => root.querySelector(sel);

  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

  function gold(c) {
    c = Math.round(c || 0);
    if (!c) return '<span class="copper">0c</span>';
    const g = Math.floor(c / 10000), s = Math.floor((c % 10000) / 100), k = c % 100;
    const parts = [];
    if (g) parts.push(`<span class="gold">${g}g</span>`);
    if (s || g) parts.push(`<span class="silver">${s}s</span>`);
    parts.push(`<span class="copper">${k}c</span>`);
    return parts.join(' ');
  }

  function setStatus(msg, isError = false) {
    const el = $('#status');
    el.textContent = msg || '';
    el.classList.toggle('error', !!isError);
  }

  function register(mod) { modules[mod.id] = mod; order.push(mod.id); }

  function renderTabs() {
    const nav = $('#tabs');
    const enabled = config?.wheelModules;
    const visible = order.filter((id) => id === 'settings' || id === current || !enabled || enabled.includes(id));
    nav.innerHTML = visible.map((id) => `<button class="tab ${id === current ? 'active' : ''}" data-id="${id}" title="${esc(modules[id].title)}">${esc(modules[id].icon)} <span class="tab-label">${esc(modules[id].title)}</span></button>`).join('');
    nav.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => window.api.invoke('panel:show', b.dataset.id)));
  }

  function show(id) {
    const mod = modules[id];
    if (!mod) return;
    if (current && current !== id) modules[current].unmount?.();
    const content = $('#content');
    if (current !== id) {
      content.innerHTML = '';
      const el = document.createElement('div');
      el.className = 'module module-' + id;
      content.appendChild(el);
      setStatus('');
      mod.mount(el);
      current = id;
    }
    renderTabs();
  }

  function onConfig(cb) { listeners.config.push(cb); }

  async function init() {
    config = await window.api.invoke('config:get');
    $('#pinned').checked = !!config.panel?.pinned;
    $('#opacity').value = config.panel?.opacity ?? 0.95;
    $('#pinned').addEventListener('change', (e) => window.api.invoke('config:set', { panel: { pinned: e.target.checked } }));
    $('#opacity').addEventListener('input', (e) => window.api.invoke('config:set', { panel: { opacity: Number(e.target.value) } }));
    $('#closeBtn').addEventListener('click', () => window.api.invoke('panel:close'));
    window.api.on('panel:module', ({ id }) => show(id));
    window.api.on('config:changed', (c) => { config = c; $('#pinned').checked = !!c.panel?.pinned; renderTabs(); listeners.config.forEach((cb) => cb(c)); });
    renderTabs();
    const st = await window.api.invoke('panel:state');
    if (st.module) show(st.module);
  }

  return { $, esc, gold, setStatus, register, show, init, onConfig, get config() { return config; }, set config(c) { config = c; } };
})();
