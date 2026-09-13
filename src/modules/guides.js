'use strict';
// Guider-modul (hovedprosess): korte strategier for verdensbosser, fraktaler, raids og strikes.
// Kilden er kun wiki.guildwars2.com (CC BY-SA 3.0): sideteksten hentes via MediaWiki API og kortes ned av AI-leverandøren
// brukeren har valgt (ai.completeText). Resultatet caches som én JSON-fil per boss i <userData>/guides/<id>.json.
// Lista over bosser ligger ferdig i data/guides.json (bygd fra wikien, sidetitlene er verifisert mot API-et).
const fs = require('fs');
const path = require('path');
const ai = require('../ai');
const log = require('../log');
const { t } = require('../i18n');

const WIKI = 'https://wiki.guildwars2.com';
const USER_AGENT = 'gw2-overlay';
const CHAT_MAX = 190;      // spillets chat tar 199 tegn; litt margin
const CHAT_LINES_MAX = 4;
const SUMMARY_LINES_MAX = 8;
const WIKI_TEXT_MAX = 14000; // tegn wikitekst som sendes til modellen

let cacheDir = null;
let data = null;

// Avhengigheter som testene bytter ut (ingen nettkall eller AI i tester)
const _deps = { fetch: (...a) => fetch(...a), ai };

function init(dir) {
  cacheDir = path.join(dir, 'guides');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) { log.warn('guides', 'Kunne ikke lage cache-mappe: ' + e.message); }
}

function list() {
  if (!data) data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'guides.json'), 'utf8'));
  return data;
}

function find(id) {
  for (const [group, entries] of Object.entries(list().groups)) {
    const e = entries.find((x) => x.id === id);
    if (e) return { ...e, group };
  }
  return null;
}

// Lenka som alltid vises sammen med utdraget (attribusjon etter CC BY-SA)
function wikiUrl(page) { return WIKI + '/wiki/' + encodeURIComponent(String(page).replace(/ /g, '_')).replace(/%3A/g, ':').replace(/%2F/g, '/'); }

// Chat-linjer: én linje hver, uten linjeskift, klippet til CHAT_MAX tegn, maks CHAT_LINES_MAX linjer, tomme fjernes
function chatLines(lines, max = CHAT_MAX) {
  if (!Array.isArray(lines)) lines = typeof lines === 'string' ? lines.split(/\r?\n/) : [];
  const out = [];
  for (const raw of lines) {
    let s = String(raw ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!s) continue;
    if (s.length > max) { s = s.slice(0, max); const sp = s.lastIndexOf(' '); if (sp > max * 0.6) s = s.slice(0, sp); s = s.replace(/[\s,;:\-–]+$/, '') + '…'; if (s.length > max) s = s.slice(0, max); }
    out.push(s);
    if (out.length >= CHAT_LINES_MAX) break;
  }
  return out;
}

const cleanLines = (v, max) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\r?\n/) : []).map((s) => String(s ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, max);

// Modellens svar til fast form; tåler manglende felt og feil typer
function normalizeGuide(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  return { summary: cleanLines(o.summary, SUMMARY_LINES_MAX), chat: chatLines(o.chat), tips: cleanLines(o.tips, 6) };
}

// Linja som limes inn i chatten for en oppføring: «Navn · [&B...=]», én linje, maks CHAT_MAX tegn
function pasteLine(entry) {
  if (!entry) return '';
  const code = entry.waypoint?.code || '';
  const name = String(entry.name || '').replace(/\s+/g, ' ').trim();
  const room = CHAT_MAX - (code ? code.length + 3 : 0);
  return (name.length > room ? name.slice(0, room - 1).trimEnd() + '…' : name) + (code ? ' · ' + code : '');
}

function cachePath(id) { return cacheDir ? path.join(cacheDir, id.replace(/[^a-z0-9_-]/gi, '_') + '.json') : null; }
function readCache(id) {
  const p = cachePath(id);
  if (!p) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeCache(id, obj) {
  const p = cachePath(id);
  if (!p) return;
  try { fs.writeFileSync(p, JSON.stringify(obj, null, 1)); } catch (e) { log.warn('guides', 'Kunne ikke skrive cache: ' + e.message); }
}

async function wikiGet(params) {
  const url = new URL(WIKI + '/api.php');
  for (const [k, v] of Object.entries({ format: 'json', redirects: 1, ...params })) url.searchParams.set(k, v);
  const res = await _deps.fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Grov rensing av wikitekst når TextExtracts ikke gir noe: maler, filer, lenker, tabeller og HTML bort
function stripWikitext(w) {
  let s = String(w || '');
  for (let i = 0; i < 6; i++) s = s.replace(/\{\{[^{}]*\}\}/g, ' ');
  s = s.replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, ' ')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:[^\s\]]*\s?([^\]]*)\]/g, '$1')
    .replace(/<ref[^>]*\/>/gi, ' ').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/^\{\|[\s\S]*?^\|\}/gm, ' ')
    .replace(/'{2,5}/g, '').replace(/^[*#:;]+\s*/gm, '- ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// Sidetekst: prop=extracts (ren tekst) først, action=parse&prop=wikitext som reserve
async function fetchWikiText(page) {
  let text = '';
  try {
    const j = await wikiGet({ action: 'query', prop: 'extracts', explaintext: 1, titles: page });
    const p = Object.values(j.query?.pages || {})[0];
    if (p && !('missing' in p)) text = String(p.extract || '');
  } catch (e) { log.warn('guides', 'extracts feilet for ' + page + ': ' + e.message); }
  if (text.trim().length < 200) {
    const j = await wikiGet({ action: 'parse', prop: 'wikitext', page });
    text = stripWikitext(j.parse?.wikitext?.['*']);
  }
  if (!text.trim()) throw new Error(t('guides.wikiEmpty', { page }));
  // Fjern seksjoner uten strategiverdi, så det som sendes er mekanikk og gjennomgang
  text = text.replace(/\n==+\s*(Dialogue|Gallery|Trivia|Notes|References|External links|See also|Version history|Related achievements|Historical NPCs)\s*==+[\s\S]*?(?=\n==[^=]|$)/g, '\n');
  return text.length > WIKI_TEXT_MAX ? text.slice(0, WIKI_TEXT_MAX) : text;
}

const GUIDE_SCHEMA = {
  name: 'bossguide',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'array', items: { type: 'string' } },
      chat: { type: 'array', items: { type: 'string' } },
      tips: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'chat', 'tips'],
    additionalProperties: false,
  },
};

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* prøv å finne objektet */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* gi opp */ } }
  throw new Error(t('ai.badJson', { text: String(text).slice(0, 500) }));
}

function buildMessages(entry, wikiText, language) {
  const bosses = (entry.bosses?.length ? `\nBosser/encounters i denne instansen: ${entry.bosses.join(', ')}.` : '') + (entry.paths?.length ? `\nStier: ${entry.paths.join(', ')}.` : '');
  return [
    { role: 'system', content: `Du er en erfaren Guild Wars 2-spiller som skriver korte, presise strategiguider til squad-medlemmer. Du får teksten fra wikisiden om et encounter og skal trekke ut det som trengs for å klare det: faser, mekanikk, hva squaden må gjøre, hva som dreper folk. Bruk bare det som står i teksten, ikke egen hukommelse. Svar alltid på ${language}, men behold engelske navn på skills, mekanikker og steder slik de står i teksten.` },
    { role: 'user', content: `Wikiside: "${entry.page}" (${entry.name}).${bosses}\n\n${wikiText}\n\nSvar som JSON med feltene:\n- "summary": 5 til 8 korte linjer med mekanikk og faser, i rekkefølgen de skjer.\n- "chat": 2 til 4 linjer som kan limes rett inn i spillets squad-chat, MAKS ${CHAT_MAX} tegn per linje, ingen linjeskift, hver linje skal stå for seg selv (f.eks. «Fase 1: …»).\n- "tips": 0 til 4 valgfrie tips (vanlige feil, hvilke boons/CC som trengs).\nTekstene på ${language}.` },
  ];
}

// Utdrag for én boss. Nytt AI-kall bare når cache mangler, språket er et annet eller refresh er satt.
// Uten AI-leverandør eller nett returneres lista/lenka fortsatt, med error-felt (og eventuelt et gammelt utdrag som stale).
async function get(cfg, id, { refresh = false, language, onProgress } = {}) {
  const entry = find(id);
  if (!entry) throw new Error(t('guides.unknownId', { id }));
  const lang = language || _deps.ai.answerLanguage();
  const base = { id, title: entry.name, page: entry.page, url: wikiUrl(entry.page), group: entry.group, map: entry.map ?? null, maps: entry.maps || (entry.map ? [entry.map] : []), bosses: entry.bosses || [], paths: entry.paths || [], location: entry.location || null, waypoint: entry.waypoint || null, pasteLine: pasteLine(entry), license: 'CC BY-SA 3.0' };
  const cached = readCache(id);
  if (cached && !refresh && cached.language === lang && Array.isArray(cached.summary)) return { ...base, ...cached, cached: true };

  const fail = (code, message) => ({ ...base, ...(cached || {}), stale: !!cached, error: { code, message } });
  const d = _deps.ai.describe(cfg);
  if (d.needsKey && !d.hasKey) return fail('NOAI', t('guides.noAi'));

  let wikiText;
  try { wikiText = await fetchWikiText(entry.page); }
  catch (e) { log.warn('guides', 'wiki feilet for ' + entry.page + ': ' + e.message); return fail('NET', t('guides.wikiFailed', { message: e.message })); }

  let guide;
  try {
    const text = await _deps.ai.completeText(cfg, buildMessages(entry, wikiText, lang), { jsonSchema: GUIDE_SCHEMA, maxTokens: 6000, onProgress });
    guide = normalizeGuide(parseJson(text));
  } catch (e) { log.warn('guides', 'AI feilet for ' + id + ': ' + e.message); return fail('AI', e.message); }
  if (!guide.summary.length && !guide.chat.length) return fail('AI', t('ai.badJson', { text: '' }));

  const rec = { title: entry.name, page: entry.page, language: lang, fetchedAt: Date.now(), summary: guide.summary, chat: guide.chat, tips: guide.tips, model: d.model || d.name };
  writeCache(id, rec);
  return { ...base, ...rec, cached: false };
}

module.exports = { init, list, find, get, chatLines, normalizeGuide, wikiUrl, stripWikitext, buildMessages, pasteLine, CHAT_MAX, CHAT_LINES_MAX, _deps };
