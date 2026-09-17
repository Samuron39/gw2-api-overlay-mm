'use strict';
// Liten DOM-modell for rendererens tilstandstester. Starter aldri Electron eller nettverk.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.attributes = {}; this.dataset = {}; this.handlers = {}; this.style = {}; this.value = ''; this.checked = false;
    this.disabled = false; this.hidden = false; this._text = ''; this.writes = 0;
    this.classList = {
      contains: (c) => (this.className || '').split(' ').includes(c),
      toggle: (c, on) => { const set = new Set((this.className || '').split(' ').filter(Boolean)); const enabled = on ?? !set.has(c); if (enabled) set.add(c); else set.delete(c); this.className = [...set].join(' '); return enabled; },
      add: (c) => this.classList.toggle(c, true), remove: (c) => this.classList.toggle(c, false),
    };
  }
  get isConnected() { return true; }
  get id() { return this.attributes.id || ''; }
  set id(v) { this.attributes.id = v; }
  get className() { return this.attributes.class || ''; }
  set className(v) { this.attributes.class = v; }
  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
  add(option) { this.appendChild(option); }
  setAttribute(k, v) {
    this.attributes[k] = v;
    if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    if (['value', 'type', 'min', 'max', 'step'].includes(k)) this[k] = v;
    if (['checked', 'disabled', 'hidden', 'selected', 'open'].includes(k)) this[k] = true;
    if (k === 'style') for (const part of v.split(';')) { const [name, val] = part.split(':'); if (name) this.style[name.trim()] = val?.trim(); }
  }
  getAttribute(k) { return this.attributes[k] ?? null; }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  replaceWith(c) { const p = this.parentElement; p.children[p.children.indexOf(this)] = c; c.parentElement = p; this.parentElement = null; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(s) { this._text = String(s); this.children = []; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(html) {
    this._html = String(html); this.writes++; this.children = []; this._text = '';
    const stack = [this], voidTags = new Set(['input', 'img', 'br', 'hr', 'meta', 'link']);
    for (const token of String(html).match(/<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
      if (!token.startsWith('<')) { stack.at(-1)._text += decode(token); continue; }
      const tag = /^<([\w-]+)/.exec(token)?.[1]; if (!tag) continue;
      const child = new Element(tag);
      const attrs = token.slice(tag.length + 1, -1);
      for (const m of attrs.matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) child.setAttribute(m[1], decode(m[2] ?? m[3] ?? m[4] ?? ''));
      stack.at(-1).appendChild(child);
      if (!voidTags.has(tag) && !token.endsWith('/>')) stack.push(child);
    }
    for (const sel of this.querySelectorAll('select')) sel.value = (sel.options.find((o) => o.selected) || sel.options[0])?.value || '';
  }
  matches(selector) {
    const tag = /^[\w-]+/.exec(selector)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    const id = /#([\w-]+)/.exec(selector)?.[1]; if (id && this.id !== id) return false;
    for (const m of selector.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(m[1])) return false;
    for (const m of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (!(m[1] in this.attributes)) return false;
      if (m[2] != null && this.attributes[m[1]] !== m[2]) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map((s) => s.trim().split(/\s+(?![^\[]*\])/));
    const all = []; const walk = (el) => { for (const c of el.children) { all.push(c); walk(c); } }; walk(this);
    return all.filter((el) => selectors.some((parts) => {
      if (!el.matches(parts.at(-1))) return false;
      let parent = el.parentElement;
      for (let i = parts.length - 2; i >= 0; i--) { while (parent && !parent.matches(parts[i])) parent = parent.parentElement; if (!parent) return false; parent = parent.parentElement; }
      return true;
    }));
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  closest(s) { let el = this; while (el && !el.matches(s)) el = el.parentElement; return el; }
  addEventListener(event, callback) { (this.handlers[event] ||= []).push(callback); }
  async dispatch(event, props = {}) {
    const e = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() { this.stopped = true; }, ...props };
    const pending = []; let el = this;
    while (el) {
      e.currentTarget = el;
      for (const f of el.handlers[event] || []) pending.push(f(e));
      if (el['on' + event]) pending.push(el['on' + event](e));
      if (e.stopped) break;
      el = el.parentElement;
    }
    await Promise.all(pending);
  }
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const flush = () => new Promise(setImmediate);
function renderer(names, invoke, config = {}) {
  const modules = {}, intervals = new Map(), listeners = new Map(), configListeners = new Set(), calls = [], statuses = [];
  let timerId = 0;
  const document = new Element('document'); document.createElement = (t) => new Element(t);
  const ctx = vm.createContext({ document, console, Date, Set, Map, CSS: { escape: String }, atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Option: function (text, value) { const el = new Element('option'); el.value = value; el.textContent = text; return el; },
    setInterval: (fn, ms) => { const id = ++timerId; intervals.set(id, { fn, ms }); return id; }, clearInterval: (id) => intervals.delete(id),
    sessionStorage: { getItem() { return null; }, removeItem() {}, setItem() {} },
    T: { t: (k, vars) => k + (vars ? ' ' + Object.values(vars).join(' ') : ''), tn: (k, n) => k + n, languages: [{ id: 'nb', name: 'Norsk' }], language: 'nb', locale: 'nb-NO' },
    window: { api: {
      invoke: (channel, ...args) => { calls.push({ channel, args }); try { return Promise.resolve(invoke(channel, ...args)); } catch (e) { return Promise.reject(e); } },
      on: (channel, fn) => { if (!listeners.has(channel)) listeners.set(channel, new Set()); listeners.get(channel).add(fn); return () => listeners.get(channel).delete(fn); },
    } },
  });
  const dir = path.join(__dirname, '../../src/renderer');
  for (const name of ['ui-state.js', 'timer-logic.js']) vm.runInContext(fs.readFileSync(path.join(dir, name), 'utf8'), ctx);
  ctx.Panel = { ...ctx.UiState, $: (s, root = document) => root.querySelector(s), esc: (s) => String(s ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), gold: String,
    setStatus: (...s) => statuses.push(s), register: (m) => { modules[m.id] = m; }, config,
    onConfig: (cb) => { configListeners.add(cb); return () => configListeners.delete(cb); },
  };
  for (const name of names) vm.runInContext(fs.readFileSync(path.join(dir, 'modules', name + '.js'), 'utf8'), ctx);
  return { ctx, modules, intervals, listeners, configListeners, calls, statuses,
    emit: (channel, payload) => { for (const fn of listeners.get(channel) || []) fn(payload); },
    root: () => document.appendChild(new Element()),
  };
}
module.exports = { Element, renderer, deferred, flush };
