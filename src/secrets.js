'use strict';
// Verdiene beholdes også etter nøkkelbytte, slik at gamle logglinjer kan renses.
const values = new Set();
const SECRET_FIELD = /key|token|secret|passw|authorization/i;
function rememberConfig(config) {
  const visit = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (SECRET_FIELD.test(key) && typeof value === 'string' && value) {
        values.add(value); values.add(encodeURIComponent(value));
      } else if (/url$/i.test(key) && typeof value === 'string') {
        try {
          const url = new URL(value);
          for (const [name, secret] of url.searchParams) if (SECRET_FIELD.test(name) && secret) { values.add(secret); values.add(encodeURIComponent(secret)); }
          if (url.password) { values.add(url.password); values.add(decodeURIComponent(url.password)); }
        } catch { /* ugyldig URL håndteres av leverandøren */ }
      } else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(config);
}
function redact(value) {
  let text = String(value ?? '');
  for (const secret of [...values].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]');
  return text
    .replace(/(Bearer\s+)[^\s"',;]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:key|api[_-]?key|access[_-]?token|token|secret|password)=)[^&#\s"'<>\\]*/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}
function stringify(value) {
  return JSON.stringify(value, (key, val) => key && SECRET_FIELD.test(key) ? '[REDACTED]' : val);
}
module.exports = { rememberConfig, redact, stringify };
