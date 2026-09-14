'use strict';
// Språk i hovedprosessen. Én JSON-fil per språk i src/i18n/ (nb.json, en.json, …) med nøkler i punktnotasjon,
// plassholdere som {name}, og enkel flertall via egne nøkler (key.one / key.other, se tn()).
// Nytt språk = ny JSON-fil i mappa, den plukkes opp automatisk. Mangler en nøkkel, brukes nb-teksten, og
// mangler den der også, vises nøkkelen selv, aldri tom tekst. Ren Node uten Electron, så den kan testes.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'i18n');
const DEFAULT_LANGUAGE = 'nb';

const dicts = new Map(); // språk-id -> ordbok (flat)
let current = DEFAULT_LANGUAGE;

// Språk for en ny installasjon ut fra systemets locale (Electron app.getLocale(), f.eks. «nb-NO», «en-US», «de»):
// norsk (nb/nn/no) gir nb, ellers et språk vi har fil for, ellers engelsk, ellers standardspråket.
function languageForLocale(locale, available = languages().map((l) => l.id)) {
  const code = String(locale || '').toLowerCase().split(/[-_]/)[0];
  if (['nb', 'nn', 'no'].includes(code)) return available.includes('nb') ? 'nb' : DEFAULT_LANGUAGE;
  if (code && available.includes(code)) return code;
  return available.includes('en') ? 'en' : DEFAULT_LANGUAGE;
}

// Alle språk som finnes som JSON-filer, sortert med standardspråket først
function languages() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { /* ingen mappe */ }
  files.sort((a, b) => (a === DEFAULT_LANGUAGE ? -1 : b === DEFAULT_LANGUAGE ? 1 : a.localeCompare(b)));
  return files.map((id) => ({ id, name: dict(id)['lang.name'] || id }));
}

function dict(lang) {
  if (!dicts.has(lang)) {
    let d = {};
    try { d = JSON.parse(fs.readFileSync(path.join(DIR, lang + '.json'), 'utf8')); } catch { /* ukjent språk: tom ordbok, alt faller tilbake */ }
    dicts.set(lang, d);
  }
  return dicts.get(lang);
}

// Setter inn {navn} fra vars. Ukjente plassholdere står som de er.
function format(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}

// Ren oppslagsfunksjon (også for testene): valgt språk, så standardspråket, så nøkkelen selv
function lookup(key, lang, fallback = {}) {
  const d = dict(lang);
  const text = d[key] ?? fallback[key];
  return text != null && text !== '' ? text : key;
}

function t(key, vars) { return format(lookup(key, current, dict(DEFAULT_LANGUAGE)), vars); }

// Flertall: key.one når n er 1, ellers key.other; n legges i vars
function tn(key, n, vars) { return t(key + (Number(n) === 1 ? '.one' : '.other'), { ...(vars || {}), n }); }

function setLanguage(lang) { current = lang && dict(lang) && Object.keys(dict(lang)).length ? lang : DEFAULT_LANGUAGE; }
function language() { return current; }
function locale() { return t('lang.locale'); }

// Alt renderer trenger: ordboka for valgt språk lagt oppå standardspråket, pluss språklista
function bundle() {
  return { language: current, locale: locale(), languages: languages(), dict: { ...dict(DEFAULT_LANGUAGE), ...dict(current) } };
}

module.exports = { DEFAULT_LANGUAGE, t, tn, format, lookup, setLanguage, language, locale, languages, bundle, dict, languageForLocale };
