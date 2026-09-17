'use strict';
// Panel-ramme: modulregister, faner, felles hjelpefunksjoner. Tekster via T (i18n.js), lastet før noe vises.
const Panel = (() => {
  const modules = {};
  const order = [];
  let current = null;
  let config = null;
  const listeners = { config: new Set() };

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

  // title kan være en funksjon (() => T.t('module.x')), så fanen følger språket
  function register(mod) { modules[mod.id] = mod; order.push(mod.id); }
  function titleOf(mod) { return typeof mod.title === 'function' ? mod.title() : mod.title; }

  function renderTabs() {
    const nav = $('#tabs');
    const enabled = config?.wheelModules;
    const visible = order.filter((id) => id === 'settings' || id === 'setup' || id === current || !enabled || enabled.includes(id));
    nav.innerHTML = visible.map((id) => `<button class="tab ${id === current ? 'active' : ''}" data-id="${id}" title="${esc(titleOf(modules[id]))}">${esc(modules[id].icon)} <span class="tab-label">${esc(titleOf(modules[id]))}</span></button>`).join('');
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
      current = id;
      Promise.resolve(mod.mount(el)).catch((e) => { if (current === id && el.isConnected) setStatus(e.message, true); });
    }
    renderTabs();
  }

  // Statiske tekster i panel.html
  function applyStatic() {
    document.title = T.t('panel.title');
    $('#grip').title = T.t('panel.dragToMove');
    $('#grip').textContent = T.t('panel.dragToMove');
    $('#pinnedLbl').textContent = T.t('panel.pinned');
    $('#pinnedWrap').title = T.t('panel.pinnedTitle');
    $('#opacityWrap').title = T.t('panel.opacity');
    $('#closeBtn').title = T.t('panel.close');
  }

  // Språkbytte: ny ordbok, statiske tekster, og gjeldende modul monteres på nytt så alt tegnes på nytt språk
  async function onLanguageChanged() {
    applyStatic();
    if (current) { const id = current; modules[id].unmount?.(); current = null; show(id); }
    else renderTabs();
  }

  function onConfig(cb) { listeners.config.add(cb); return () => listeners.config.delete(cb); }

  async function init() {
    await T.load();
    applyStatic();
    config = await window.api.invoke('config:get');
    $('#pinned').checked = !!config.panel?.pinned;
    $('#opacity').value = config.panel?.opacity ?? 0.95;
    $('#pinned').addEventListener('change', (e) => window.api.invoke('config:set', { panel: { pinned: e.target.checked } }));
    $('#opacity').addEventListener('change', (e) => window.api.invoke('config:set', { panel: { opacity: Number(e.target.value) } }));
    $('#closeBtn').addEventListener('click', () => window.api.invoke('panel:close'));
    window.api.on('panel:module', ({ id }) => show(id));
    window.api.on('config:changed', async (c) => {
      config = c; $('#pinned').checked = !!c.panel?.pinned;
      if (await T.sync(c)) await onLanguageChanged();
      renderTabs(); listeners.config.forEach((cb) => cb(c));
    });
    renderTabs();
    const st = await window.api.invoke('panel:state');
    if (st.module) show(st.module);
  }

  return { $, esc, gold, setStatus, register, show, init, onConfig, ...UiState, get config() { return config; }, set config(c) { config = c; } };
})();
