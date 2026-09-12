'use strict';
// Global T for vinduene (panel, hjul, overlay): henter ordboka fra hovedprosessen ('i18n:get') ved oppstart og på
// nytt når språket endres (config:changed). T.t(key, vars) gir teksten, ellers nøkkelen selv, aldri tom tekst.
const T = (() => {
  let dict = {};
  let language = '';
  let locale = 'nb-NO';
  let languages = [];

  function format(text, vars) {
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
  }
  function t(key, vars) {
    const text = dict[key];
    return format(text != null && text !== '' ? text : key, vars);
  }
  // Flertall: key.one når n er 1, ellers key.other
  function tn(key, n, vars) { return t(key + (Number(n) === 1 ? '.one' : '.other'), { ...(vars || {}), n }); }

  async function load() {
    const b = await window.api.invoke('i18n:get');
    dict = b.dict || {};
    language = b.language;
    locale = b.locale || 'nb-NO';
    languages = b.languages || [];
    document.documentElement.lang = language;
    return b;
  }

  // Kalles på config:changed: laster ordboka på nytt hvis språket er byttet. Returnerer true når det skjedde.
  async function sync(config) {
    if (!config || config.language === language) return false;
    await load();
    return true;
  }

  return { t, tn, format, load, sync, get language() { return language; }, get locale() { return locale; }, get languages() { return languages; } };
})();
