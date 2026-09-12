# GW2 Overlay

Modulær overlay for Guild Wars 2. Et lite hjul ligger over spillet og åpner moduler i et panel. Alt kjører lokalt. Eneste eksterne kall er til det offisielle GW2 API-et, pluss dps.report hvis du selv trykker "Last opp".

Moduler: **Inventory** (rådgiver med lokal AI), **I dag** (Wizard's Vault, world bosses, fraktaler, kister), **Tidsplan** (world bosses og meta-events med waypoint rett i chatten), **Trading Post**, **DPS** (fra ArcDPS-logger), **Karakterer** (utstyr og AI-vurdering), **Guild** og **Innstillinger**.

## Kom i gang

```bash
npm install
npm start
```

1. Hjulet dukker opp. Dra det i midten, lås plasseringen med hengelåsen. Klikk et segment for å åpne modulen i panelet. Ctrl+Shift+G viser eller skjuler panelet.
2. Lag en API-nøkkel på <https://account.arena.net/applications> med **alle** tillatelser: account, inventories, characters, wallet, unlocks, progression, tradingpost, builds, guilds. Lim den inn under *Innstillinger*.
3. Start serveren i LM Studio med en modell lastet med 16k kontekst. Standard i appen er `google/gemma-4-12b-qat`.
4. Posisjon fra spillet og waypoint-innliming i chatten går via en liten Rust-hjelper (`helper/`). Kjører du fra kildekoden, bygg den én gang med `cargo build --release` i `helper/` (krever Rust). Uten hjelperen fungerer alt annet.

Kjør GW2 i borderless windowed, så ligger hjulet og panelet oppå spillet.

## Modulene

### Inventory
Henter alt fra kontoen og gir én anbefaling per item: selg på TP, selg til vendor, salvage, deposit, åpne, bruk eller behold, med verdier ved siden av. Regelmotoren i [rules.js](src/rules.js) gjør regnestykkene. Fanen *AI-rådgiver* lager en prioritert oppryddingsplan og svarer på spørsmål med den lokale modellen.

Rådgiveren bruker det kontoen vet: items som teller i en samling du ikke har fullført får *Bruk* med samlingens navn (📘), utstyr med skinn som ikke er i garderoben får *Salvage* siden det låser opp skinnet (🎨), farger, oppskrifter og minis du allerede har får *Selg* (♻️) og de du mangler får *Bruk* (🔓). Items du allerede har ute for salg merkes (🏷️). Filteret øverst har egne valg for disse. Samlingsindeksen bygges første gang fra alle 8 000 achievements, det tar rundt 20 sekunder, og caches i en uke.

### I dag
Wizard's Vault daglig, ukentlig og spesial med fremdrift per mål. World bosses med hvilke du har drept i dag, neste spawn og waypoint. Daglige fraktaler, daglig crafting og Hero's Choice-kister. Nedtelling til daglig og ukentlig reset.

### Tidsplan
Alle 44 tidsplaner fra GW2-wikien. Viser hva som skjer nå, hva som er neste, og kart og waypoint. Klikk på waypointen, så limes chat-lenken inn i chatten i spillet, du trykker Enter og klikker lenken. Står du på kartet det skjer på, merkes raden «her». Bosses du har drept i dag merkes «✓ i dag». Skjul tidsplaner med *Velg hva som vises*.

### Trading Post
Salg ute med varsel når du er underbudt, kjøpsordrer med varsel når du er overbudt, historikk med netto etter avgift, leveringsboks, og solgt og kjøpt siste 7 og 30 dager.

### DPS
Leser ArcDPS-logger og viser skade per spiller mot boss og totalt, boon-uptime for quickness, alacrity og fury, og kan laste opp loggen til dps.report. Mappa overvåkes, ny kamp dukker opp automatisk. Dette er post-fight: GW2 har ingen kamp-API, og bare ArcDPS leser spillets minne. Live-tall ser du i ArcDPS sitt eget vindu. Healing krever Healing Stats-addonen og er ikke med ennå.

Knappen *Slik virker det* forklarer oppsettet og installerer eller oppdaterer ArcDPS: appen laster ned `d3d11.dll` fra utgiverens offisielle adresse, verifiserer MD5-summen mot den publiserte, tar backup av en eventuell gammel fil og legger den i spillmappa. ArcDPS pakkes ikke med appen, utgiveren tillater ikke videredistribusjon, og fila må uansett oppdateres ved hver spillpatch. Installasjon krever at spillet er avsluttet.

### Live (buffs, conditions, target og skill-bar)
Live-data krever ArcDPS pluss vår egen ArcDPS-utvidelse, broen. Broen er en liten DLL (`bridge/`, skrevet i Rust) som ArcDPS laster fra `addons\arcdps\`. Den får kamphendelsene ArcDPS allerede leser, og sender dem som JSON over UDP til overlayen på 127.0.0.1:47500. Den leser ingenting selv. Installer den fra Live-modulen, start spillet på nytt, så viser modulen "Live-data mottas".

Fire små overlay-vinduer, hvert med egen posisjon, størrelse, ikonstørrelse og gjennomsiktighet, og hver kan låses:

- **Buffs på deg** og **Conditions på deg**, eller ett vindu med alt. To utseender: rutenett med ikoner, eller liste med et lite ikon, fullt navn, stacks og sekunder på enden. Gjenværende tid som tall, som skygge (kakediagram i rutenettet, en stolpe som krymper bak navnet i lista), eller begge. Sortering: minst tid først, mest tid først, flest stacks først, eller navn.
- **Målet**: conditions og buffs på den du sist traff, for eksempel bossen.
- **Skill-bar**: legges over spillets skill-bar. Øverst profesjonsmekanikken (F1–F5, elite-spec sine erstatter kjernen), under våpen 1–5, heal, tre utility og elite, alle med ikoner fra API-et for karakteren du spiller akkurat nå. Cooldown vises som nedtelling på hvert ikon, og neste skill i rotasjonen lyser gult.

**Builds og våpensett.** API-et gir alle lagrede build-faner per karakter (krever *builds*) og våpnene i sett A og B fra utstyret. Skill-baren følger den aktive fanen, kontrollert mot elite-spec fra spillet, og bytter til sett B når ArcDPS melder våpenbytte. I Live-modulen velger du build og våpensett du redigerer. Rotasjon og hold-oppe lagres per build og våpenkombinasjon, så en build med sverd og skjold i A og langbue i B får to rotasjoner som byttes automatisk.

**Rotasjon** redigeres steg for steg, eller foreslås av den lokale AI-modellen med tydelig forbehold.

**Hold oppe.** Par av skill og boon, for eksempel elite-skillet og Might. Når boonen mangler på deg og skillet er klart, blinker skillet rødt i skill-baren med boonens forkortelse i hjørnet. «Foreslå fra skillene» fyller lista ut fra hvilke boons hvert skill gir ifølge API-et.

**Ikoner.** Boons og conditions vises med ikonene fra spillet, hentet fra [GW2-wikien](https://wiki.guildwars2.com) (CC BY-SA 3.0, ikonene tilhører ArenaNet) og lagret i `assets/effects/<buff-id>.png` med kildeliste i `ATTRIBUTION.md` der. Andre effekter (skill-buffs) slås opp i skill-indeksen fra API-et og vises med ikonet fra render.guildwars2.com, hentet i batch maks én gang i sekundet. Mangler ikon, står forkortelsen (MGT, QCK, BLD …) som før. «Vis ikoner» per vindu slår det av.

Ulåst vindu har stiplet ramme: dra for å flytte, strekk i kantene. Låst vindu slipper alle klikk gjennom til spillet.

### Karakterer
Utstyr per karakter med stat-kombinasjon, runer, sigiller og infusions. Automatiske funn: tomme slots, manglende oppgraderinger, utstyr under Exotic på level 80, tomme infusion-slots. Knappen *Vurder utstyret med AI* sender utstyret og siste ArcDPS-logg med karakteren til den lokale modellen.

### Guild
MOTD, logg, lager og treasury med hva som mangler til pågående oppgraderinger, for hver guild kontoen er med i. Krever guilds-tillatelse og at rangen din har innsyn i guilden.

### Innstillinger
API-nøkkel, LM Studio, inventory-regler, ArcDPS-loggmappe, hvilke moduler som vises på hjulet og som faner, hjulstørrelse, auto-skjul ved alt-tab, start med Windows. Viser hvor konfigfila ligger og om siste lagring feilet.

## Arkitektur

```
src/main.js                  Electron: hjul- og panelvindu, konfig, IPC, auto-skjul, hurtigtast
src/preload.js               allowlist for IPC-kanaler
src/mumble.js + helper/      MumbleLink (posisjon, kart, fokus, kamp) og chat-innliming via Rust-hjelperen
src/gw2.js                   GW2 API-klient med item-cache og samlingsindeks
src/rules.js                 regelmotor for inventory
src/ai.js                    LM Studio-klient (strømmende, tåler resonneringsmodeller)
src/evtc.js                  ArcDPS EVTC-parser med boon-uptime
src/modules/*.js             modul-logikk i hovedprosessen (inventory, daily, timers, tp, dps, characters, guild)
src/renderer/wheel.*         hjulet
src/renderer/panel.*         panelramme og modulregister
src/renderer/modules/*.js    modul-UI
data/                        tidsplaner og waypoints fra wikien (CC BY-SA)
```

En ny modul er to filer: `src/modules/<navn>.js` med IPC-handlere registrert i main.js og kanalen i preload.js, og `src/renderer/modules/<navn>.js` som kaller `Panel.register({ id, title, icon, mount, unmount })`. Legg id-en til i `MODULES` i `wheel.js` og skriptet i `panel.html`.

## Minne og modellvalg mens du spiller

| Modell | Vekter | Ved siden av GW2 |
|---|---|---|
| google/gemma-4-12b-qat | 6,7 GB | God margin |
| qwen/qwen3.8-27b (Q4_K_M) | 16,5 GB | Så vidt, GW2 trenger 4 til 8 GB |

Kontekstlengden avgjør. Last med 16k, ikke maks:

```bash
lms load google/gemma-4-12b-qat --context-length 16384 --gpu max -y
```

## Dele appen med andre

```bash
npm run dist:installer
```

Lager `dist/GW2 Overlay Setup <versjon>.exe` med electron-builder. Installeren inneholder bare koden og datafilene. API-nøkkel og alle innstillinger ligger i brukerprofilen (`%APPDATA%\gw2-inventory-overlay`) og følger aldri med. Den som installerer får Innstillinger opp første gang, med spillmappa funnet automatisk, og legger inn sin egen nøkkel.

Etter installasjon ligger appen i Start-menyen og i systemstatusfeltet. Med *Start med Windows* og *Vis overlayen bare når spillet kjører* slått på, starter overlayen i praksis sammen med spillet: hjulet dukker opp når `Gw2-64.exe` starter og forsvinner når spillet avsluttes.

Hjelperen for posisjon og chat-innliming (`helper/gw2overlay_helper.exe`, bygd fra `helper/` med `cargo build --release`) pakkes med installeren, så ingen ekstra programvare trengs på maskinen.

Ikonene ligger i `assets/`: `icon.png` og `icon.ico` (app, installer og snarvei), `tray.png` (systemstatusfeltet) og `wheel.png` (midten av hjulet). Alle er laget fra samme logo.

## Utgivelse

Appen oppdaterer seg selv fra GitHub Releases (electron-updater). Slik lager du en ny utgivelse:

1. Bump `version` i `package.json` (for eksempel 0.2.0 til 0.2.1). electron-updater sammenligner semver, så nummeret må være høyere enn det brukerne har.
2. Sett et GitHub-token med repo-tilgang i miljøet. Er `gh` innlogget holder det med:

   ```bat
   for /f %t in ('gh auth token') do set GH_TOKEN=%t
   ```

   eller `set GH_TOKEN=<token>` direkte.
3. Kjør `npm run release`. Det bygger NSIS-installeren og laster opp `GW2 Overlay Setup <versjon>.exe`, `.blockmap` og `latest.yml` til en GitHub Release merket `v<versjon>` (opprettes som utkast første gang; publiser den på GitHub). `latest.yml` er fila appene hos brukerne leser for å finne ny versjon.

Installerte apper sjekker ved oppstart (10 s etter start) og hver 6. time, laster ned i bakgrunnen og installerer når overlayen avsluttes. Under *Innstillinger → Oppdatering* kan brukeren sjekke manuelt, se fremdrift og trykke «Installer og start på nytt», eller slå av den automatiske sjekken. I utvikling (`npm start`) gjøres aldri nettverkskall for oppdatering.

To ting å vite:

- electron-builder laster ned `winCodeSign` til cachen (`%LOCALAPPDATA%\electron-builder\Cache\winCodeSign`) og feiler på symlinker i arkivet uten utviklermodus. Pakk 7z-arkivet ut manuelt til mappa `winCodeSign-<versjon>` ved siden av det én gang, så bygger det.
- Installeren er ikke kodesignert. Det er greit for electron-updater på Windows: oppdateringer aksepteres så lenge utgiveren (publisher) i den nye installeren er den samme som i den installerte. Bytter du signering eller publisher senere, må brukerne installere manuelt én gang.

## Testing uten API-nøkkel

```bash
GW2_DEMO=1 npm start
```

`GW2_SHOT=<fil.png> GW2_SHOT_MODULE=<modul>` tar et skjermbilde og avslutter. Testkjøringer bruker egen konfig-mappe og rører aldri din.

## Feilsøking

Appen skriver en loggfil, `logs\app.log`, i brukerprofilen (`%APPDATA%\gw2-inventory-overlay\logs`). Den roteres ved 2 MB, de to forrige beholdes som `app.log.1` og `app.log.2`. Loggen har oppstartsinformasjon, feil fra GW2 API-et (også 429-retry), når ArcDPS-broen kobler til og fra, feil i MumbleLink-hjelperen, parse-feil i DPS-logger, IPC-feil og feil fra vinduene. Under *Innstillinger → Feilsøking* åpner «Åpne loggmappe» mappa, og «Kopier feilrapport» legger en tekst på utklippstavla med app-, Electron- og OS-versjon, innstillingene uten API-nøkkel, hvilke moduler som er på, om ArcDPS og broen er installert, live-tilstand og de siste 200 logglinjene. Lim den inn når du melder en feil. Testkjøringer (`GW2_SHOT`) logger til sin egen mappe (`%TEMP%\gw2-overlay-test\logs`).

## Begrensninger

- GW2 API-et er kun lesing. Appen kan ikke selge, flytte eller bruke noe for deg.
- Inventory-data i API-et kan ligge noen minutter etter spillet.
- Materiallager-kapasiteten kan ikke leses fra API-et. Standard er 250.
- EVTC-parseren er testet på syntetiske logger, ikke ekte ennå.
- I dag, Trading Post, Karakterer og Guild er skrevet etter API-dokumentasjonen og ikke kjørt mot en ekte konto ennå.
