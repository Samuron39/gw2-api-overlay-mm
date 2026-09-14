# Oppdrag: fanen «Guider» (feat/guides)

Les først `docs/BRIEF-felles.md` (reglene der gjelder: worktree, i18n nb+en nederst i filene, tester, commit-format,
ikke push, ikke versjonsbump). ArcDPS-delen av den briefen er ikke relevant her.

## Hva som skal bygges
En ny panel-modul `guides` («Guider») med korte strategier for verdensbosser, fraktaler, raids og strikes, laget som
AI-utdrag fra Guild Wars 2-wikien (CC BY-SA 3.0, med lenke tilbake), med «Lim inn i chat»-linjer på maks 199 tegn.

### Datakilde og lisens
- Kun wiki.guildwars2.com. Hent sidetekst via MediaWiki API, f.eks.
  `https://wiki.guildwars2.com/api.php?action=query&prop=extracts&explaintext=1&format=json&redirects=1&titles=<Boss>`
  (prop=extracts gir ren tekst; fall tilbake til `action=parse&prop=wikitext` hvis extracts ikke finnes). Send User-Agent
  `gw2-overlay`. Alltid vise lenka `https://wiki.guildwars2.com/wiki/<Side>` og teksten «AI-utdrag fra wikien (CC BY-SA), sjekk selv».
- AI: bruk `ai.completeText(cfg, messages, { maxTokens })` fra `src/ai.js` (den bruker leverandøren brukeren har valgt: LM Studio
  lokalt eller Gemini/OpenAI osv.). Svarspråk: `ai.answerLanguage()`. Be om JSON `{ "summary": ["linje", ...], "chat": ["linje", ...], "tips": ["..."] }`
  der `summary` er 5–8 korte linjer med mekanikk og faser, `chat` er 2–4 linjer på MAKS 190 tegn hver (kontroller og klipp i koden,
  spillets chat tar 199), `tips` valgfrie. Bruk `opts.jsonSchema` som i `prioritize()` i ai.js (schema-støtte varierer per leverandør,
  ai-providers.js håndterer det; parse robust som `parseJson` der).
- Cache: én JSON-fil per boss i `userData/guides/<slug>.json` med `{ title, page, language, fetchedAt, summary, chat, tips, model }`.
  Nytt AI-kall bare når fila mangler, språket er et annet, eller brukeren trykker «Hent på nytt». `gw2.init(dir)` viser hvordan
  userData-stien deles ut fra main.js (legg til tilsvarende `guides.init(dir)`).

### Liste over bosser (bygges inn som data)
- Lag `data/guides.json` med grupper: `worldbosses` (alle bosser fra `data/event-timer-wiki.json` som er verdensbosser/meta med
  navn og wiki-side), `fractals` (alle fraktaler i spillet med bossene per fraktal, wiki-side per fraktal), `raids` (alle raid-vinger
  med bosser), `strikes` (alle strike missions). Hent listene fra wikien der du kan (kategorisider via API), ellers skriv dem inn;
  det viktige er riktig wiki-sidetittel per oppføring. Feltet `map` (map-id fra API-et, se `data/waypoints.json` og
  `/v2/maps`) der det er kjent, så guiden for kartet du står på kan legges øverst (MumbleLink gir `mapId`, panelet får det via
  `mumble:state`, se `src/renderer/wheel.js` for mønsteret).

### Modulen
- Hovedprosess: `src/modules/guides.js` med `list()`, `get(cfg, id, { refresh, language })`, `init(dir)`. IPC i `src/ipc.js`:
  `guides:list`, `guides:get` (id, refresh), og gjenbruk `game:paste` for chat-linjer og `open:url` for wikilenka.
  Legg kanalene i allowlisten i `src/preload.js`. AI-fremdrift kan sendes som `ai:progress` (finnes).
- Renderer: `src/renderer/modules/guides.js`, registrert i `src/renderer/panel.html` (script) og på hjulet: legg `guides` inn i
  `MODULES` i `src/renderer/wheel.js` (ikon 📖) og i `ALL`-lista over moduler i `src/renderer/modules/settings.js`, samt
  `module.guides` i i18n. Utseende: venstre kolonne med søkefelt og grupper (sammenleggbare), høyre kolonne viser valgt guide:
  tittel, «Kartet du står på»-merke når det passer, `summary` som punktliste, `chat`-linjene med en «Lim inn i chat»-knapp hver
  (og «Kopier»), «Hent på nytt», wikilenke og lisenslinje. Følg stilen i `src/renderer/modules/timers.js`/`dps.js` (kort, `.muted`, knapper).
  Tidsplan-fanen (`timers.js`): en liten «Strategi»-knapp på hver boss-rad som åpner Guider på riktig boss
  (`window.api.invoke('panel:show', 'guides')` + en måte å velge id på, f.eks. `Panel`-hendelse eller `sessionStorage`).
- Feil: uten AI-leverandør/nøkkel skal fanen fortsatt vise lista, wikilenka og en tydelig melding om at utdrag krever AI (Innstillinger).
  Uten nett: vis cachet utdrag om det finnes.

### Tester
`test/guides.test.js`: bygging av chat-linjer (klipping til 190 tegn, ingen linjeskift), cache-logikk (bruk en temp-mappe),
og at `data/guides.json` er gyldig med unike id-er og wiki-sider. Mock AI og fetch, ingen nettkall i tester.

### Sluttrapport
Hva som er bygd, hvilke filer, hvor mange oppføringer per gruppe, hva som ikke er verifisert (ekte AI-kall og wiki-oppslag skal
prøves av arkitekten etterpå), og ting du fant utenfor oppdraget.
