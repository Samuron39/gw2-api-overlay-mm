# AGENTS.md: slik er GW2 Overlay satt opp, og det vi har lært

Les denne før du endrer noe. Den gjelder for alle agenter (Claude Code, underagenter i worktrees, andre verktøy) og for
mennesker som skal inn i koden. README.md (engelsk, GitHub-forsida) og README.nb.md (norsk, fullstendig) er brukerrettet; dette er arbeidsdokumentet. Datoer er absolutte.

## 1. Prosjektet på ett minutt

- Modulær Electron-overlay for Guild Wars 2, startet 11. september 2026. Norsk bokmål er standardspråk i kode-kommentarer,
  commit-meldinger og UI; engelsk er andre UI-språk. Repo: https://github.com/Samuron39/gw2-api-overlay-mm (main, offentlig).
- Flyttbart hjul + panel med moduler: inventory (regelmotor + AI), I dag, Tidsplan, Trading Post, DPS (EVTC-logger),
  Live (ArcDPS-bro, buffs/target/skill-bar/DPS-meter), Karakterer, Guild, Guider (AI-utdrag fra wikien), Kom i gang
  (førstegangsveiviser) og Innstillinger.
- Eieren (Samuron39) spiller på en maskin med RTX 5090, 4K med 250 % skalering, spillet i `C:\Guild Wars 2`, LM Studio
  lokalt på port 1234 som standard AI, Gemini som sky-alternativ. Svar til eieren på norsk.

## 2. Kart over koden

```
src/main.js                  oppstart, oppdateringsvarsel (ballong + Innstillinger), sjekk ved spillstart
src/config.js                konfig i %APPDATA%\gw2-inventory-overlay\config.json, DEMO/TEST_MODE
src/windows.js               hjul, panel, overlay-vinduer, tray, ballong, følg-spillet (startFollowGame)
src/ipc.js                   ALLE IPC-handlere via handle()-wrapperen (logger feil), gruppert per modul
src/preload.js               allowlist: hver ny kanal må inn her
src/i18n.js + src/i18n/      t(key, vars); nb.json og en.json må ha identiske nøkler, nye nøkler NEDERST i begge
src/ai.js + src/ai-providers.js   AI-klient (strømmende) + leverandører (local, gemini, openai, anthropic, deepseek, xai, custom)
src/live.js                  mottar broens UDP-strøm og bygger tilstanden: buffs, cooldowns, target, fight/session-DPS,
                             squad, damage taken/death log, healing, opptak til logs/live-*.jsonl
src/overlays.js              DEFAULTS per overlay-type (buffs, debuffs, target, skillbar, dps, dps2, dps3, bosses)
src/modules/*.js             modul-logikk i hovedprosessen (arcdps = installer/oppdaterer for ArcDPS og broen)
src/renderer/overlay.*       tegner overlay-vinduene (render() velger etter TYPE, renderDps for DPS-meteret)
src/renderer/panel.*         panelramme, modulregister, dra-linje (#grip)
src/renderer/modules/*.js    modul-UI, Panel.register({ id, title, icon, mount, unmount })
src/renderer/wheel.js        hjulet, lista MODULES (ikon per modul)
bridge/                      ArcDPS-utvidelse i Rust (cdylib, arcdps-crate 0.11.2) -> UDP 127.0.0.1:47500, protokollen står
                             øverst i bridge/src/lib.rs
helper/                      Rust-hjelper: MumbleLink og innliming i spillets chat
data/                        tidsplan, waypoints og guides.json fra wikien (CC BY-SA)
docs/                        PLAN-stabilisering-2026-09-17.md (ENESTE gjeldende plan, «Åpent nå» nederst), VALIDERING-2026-09-17.md,
                             releases/<versjon>.md (utgivelsesnotater), healing-api.md, BRIEF-felles.md (mal for underagenter),
                             BRIEF-guider.md (eksempel). PLAN-review-fixes.md og REVIEW-2026-09-16.md er avsluttet historikk.
test/                        node:test, kjør `npm test` (283 tester per 19. sept 2026, må være grønn før commit)
```

Ny overlay-vindustype = DEFAULTS i `src/overlays.js`, typen i `OVERLAY_TYPES` og nøklene i `bounds`/`enums`/`bools` i
`src/config-validation.js` (brukes av BÅDE lagring og lasting: 0.4.11 glemte lastingen, så valget forsvant ved omstart), beholder
+ gren i `overlay.html`/`overlay.js` (`applyConfig`, `render`), kort i `renderWindows` i `src/renderer/modules/live.js` (lista `WIN`),
`overlay.label.<type>` og `live.win.<type>` i begge i18n-filene. Se `bosses` (0.4.11) som mønster.

Ny innstilling skal alltid prøves gjennom `normalize(saved, DEFAULT_CONFIG)`, ikke bare `config:set`: det er lastingen som avgjør om
valget overlever en omstart.

Ny modul = `src/modules/<navn>.js` + `src/renderer/modules/<navn>.js`, IPC i ipc.js, kanal i preload.js, skript i
panel.html, id i MODULES i wheel.js og i ALL-lista i settings.js, tekster `module.<navn>` i begge i18n-filene.

## 3. Regler som ikke skal brytes

1. **Start eller stopp ALDRI eierens overlay fra et verktøy** (Bash/PowerShell). 13. sept 2026 ga det en sandkasse-instans
   som skrev i samme konfigmappe, og verktøyene så en gammel, tom kopi av config.json mens appen selv hadde alt intakt.
   Stol ikke på det verktøyene leser fra `%APPDATA%\gw2-inventory-overlay\`. Sannheten er eierens «Kopier feilrapport»
   (Innstillinger → Feilsøking): app/Electron/OS-versjon, konfig uten nøkler, live-tilstand, `window.__diag()` per
   overlay-vindu og de siste 200 logglinjene. Be eieren starte/stoppe selv.
2. Testkjøringer bare med `GW2_DEMO=1` og/eller `GW2_SHOT=<png>` (egen userData-mappe under `%TEMP%\gw2-overlay-test`).
3. API-nøkler (GW2, AI-leverandører under `aiProviders`) skal aldri i feilrapporter, logger, commits eller svar.
4. Commit som `git -c user.name=Samuron39 -c user.email=illusiveman662@gmail.com commit`, avslutt meldingen med
   `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Norsk commit-melding, versjonsnummer i parentes når det bumpes.
5. i18n: begge språkfilene, samme nøkler, nye nøkler nederst. `test/i18n.test.js` håndhever det.
6. Alle overlay-vinduer er gjennomsiktige og rammeløse (og radene i DPS-meteret tegnes på nytt ti ganger i sekundet, så
   klikk der håndteres med `pointerdown` og delegering på `#dps`, klassen `.click`; et vanlig `click` uteblir ofte): `<select>` åpner seg ikke der (bruk knapper som bytter verdi),
   og `[hidden]` må være `display:none!important` globalt fordi `#grid{display:flex}` ellers vinner.
7. Ikke foreslå betalte API-er som standard. Lokal AI (LM Studio) er standard; sky er valgfritt.
8. Knapper med sideeffekt (installer, lagre, ta opp, kopier) skal kvittere synlig VED knappen med `Panel.busy()` og et
   `.act-note`-felt (spinner, så grønn hake eller rød feil). Statuslinja øverst i panelet er ikke nok: eieren så den ikke.
9. Appen og agenter endrer ALDRI antivirus-innstillinger (ekskluderinger, «tillat på enheten»). Forklar og la eieren gjøre det.

## 4. Utgivelse (bekreftet virker, auto-oppdatering når eieren)

```
npm version X.Y.Z --no-git-tag-version
git commit ... && git push
GH_TOKEN=$(gh auth token) npm run release          # bygger NSIS, laster opp exe + blockmap + latest.yml som utkast
gh release edit vX.Y.Z --draft=false --latest --title "GW2 Overlay X.Y.Z" --notes-file <fil>
curl -sL https://github.com/Samuron39/gw2-api-overlay-mm/releases/latest/download/latest.yml   # skal vise ny versjon
```

- Repoet må være offentlig (electron-updater leser latest.yml uten innlogging).
- Appen sjekker 10 s etter oppstart, hver 6. time og hver gang Gw2-64.exe starter; ved nedlastet versjon vises en ballong
  fra systemstatusfeltet og Innstillinger åpnes med oppdateringskortet uthevet (én gang per versjon).
- electron-builder: winCodeSign-arkivet må være pakket ut manuelt én gang til
  `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0` (symlenker i arkivet feiler uten utviklermodus).
- Broen (`bridge/target/release/gw2overlay_bridge.dll`) bygges med `cargo build --release` i `bridge/` FØR release
  (`scripts/check-native.js` stopper deg ellers). Eieren installerer ny bro via Live-fanen; si fra når broen er endret.
- Gjeldende utgivelsesversjon: 0.4.14 (19. sept 2026). Publiseringsstatus bekreftes mot GitHub Releases.

## 5. ArcDPS: målte fakta (build 20260816), ikke antakelser

Kilde: deltaconnected sine README-er (api og evtc), kopiert til `C:\Apper\gw2-wt\docs\` (ikke i repoet), pluss ekte
UDP-opptak `opptak-2026-09-13.log` samme sted. Siter README-linjer i kodekommentarene.

- Utvidelser lastes fra SPILLMAPPA (ved siden av d3d11.dll), ikke `addons\arcdps`. Filnavnet må inneholde «arcdps»:
  vi installerer `C:\Guild Wars 2\arcdps_gw2overlay_bridge.dll`. Sjekk at den er lastet med
  `tasklist /M arcdps_gw2overlay_bridge.dll` (PowerShell) eller linja «GW2 Overlay Bridge» i `addons\arcdps\arcdps.log`.
- `get_init_addr` får ArcDPS sin imgui-versjon som 7. argument og eksporttabellen må oppgi samme verdi. Crate-makroen
  hardkoder 18000, derfor er eksporten håndskrevet i `bridge/src/lib.rs`.
- `combat_local` («chatbox events») er sanntid, men gir bare treff (NEGATIV value for skade, POSITIV for healing),
  condition-ticks (buff=1, buffDmg!=0), kamp inn/ut (sc 1/2) og logg start/slutt (sc 9/10).
- `combat` (område/evtc) har alt annet (buff-påføringer, aktiveringer, våpenbytte, andres hendelser) men kommer
  2–3 s forsinket (målt 2,6 s hos eieren). Utenfor instanser bare squaden. La aldri område-hendelser sette
  klokkeavviket i live.js.
- evtc-kanalen merker vanlige hendelser med egne statechange-koder, og de er NØYAKTIG README-ordinalene (telt i
  `arcdps-evtc-README.txt`, CBTS_COMBAT = 0): 67 ANIMATIONSTART, 68 ANIMATIONSTOP (act 3/5/6 utført, 4 avbrutt),
  69 BUFFAPPLY, 70 BUFFCHANGE (overstack = ny varighet), 71 BUFFREMOVE_SINGLE, 72 BUFFREMOVE_ALL. live.js normaliserer dem.
- Kamp inn/ut (sc 1/2) kommer på BEGGE kanaler (samme time, ulik id, evtc-kopien 2–3 s etter); live.js ignorerer dem
  fra area. Dødsstøt (result 8) har alltid value 0 og buffDmg 0. BUFFINITIAL (sc 18): value = gjenværende, buffDmg =
  opprinnelig varighet. Klokkeavviket er null til første hendelse; area får sette det bare når ingen local har kommet.
- ArcDPS melder at du VELGER et mål, aldri at du slipper det (ingen målbytte med id 0 i opptakene). live.js slipper derfor målet
  selv etter 8 s uten livstegn utenfor kamp og 20 s i kamp (`expireTarget`). Sett målet med `touchTarget(id)`, ikke `targetId =`.
- Målbytte: ev null, src.elite == 1. Agent lagt til: ev null, src.prof != 0. Dødsstøt: result 8. Ingen
  CHANGEDEAD/HEALTHPCTUPDATE for vanlige fiender i åpen verden; target tømmes på sc 2 eller eget dødsstøt.
- Egne condition-ticks på chatbox-kanalen (målt 18. sept 2026, condition-warrior, build 20260915): `buff 1`, NEGATIV `buffDmg`,
  `iff 1`, `result 0` (ikke 14 som i evtc-logger). Healing er POSITIV med `iff 0`. Broens regel «buff == 1 og buff_dmg > 0 =
  healing» er derfor riktig. Opptaket ligger i `C:\Apper\gw2-wt\docs\opptak-2026-09-18-condi.jsonl` (ikke i repoet) og gir
  278 357 egen skade, 16 542 mottatt og 22 049 healing når det spilles av gjennom `live.handle()`. Anonymisert kopi:
  `test/fixtures/live-condi-2026-09-18.jsonl.gz`, låst i `test/live-replay.test.js`. Nye opptak anonymiseres med
  `node scripts/anonymize-recording.js <opptak.jsonl> test/fixtures/<navn>.jsonl.gz` før de legges i repoet.
- Healing: ArcDPS har ingen heal-hendelse; chatbox-kanalen viser healing som positive verdier (samme regler som
  «arcdps healing stats», se `docs/healing-api.md`). Utvidelsen leveres via CBTS_EXTENSIONCOMBAT med signatur 0x9c9b3c99.
- «Broen virker ikke» betyr oftest at ArcDPS selv mangler. 18. sept 2026 fjernet Windows Defender `C:\Guild Wars 2\d3d11.dll`
  (offisiell build 20260915, riktig MD5) som `Trojan:Win32/Posilod.CA!cl`; `!cl` er sky-maskinlæring, feilflagging er vanlig.
  Sjekk i denne rekkefølgen: finnes `d3d11.dll`, har `addons\arcdps\arcdps.log` linjer fra i dag, `Get-MpThreatDetection`.
  Appen varsler nå selv (`status().removedExternally`, `verifyKept()` etter installasjon).
- EVTC-logger fra ÅPEN VERDEN er kart-logger: mappa heter «<hendelse/kart> (<kart-id>)», id-en i hodet er kart-id og ingen agent
  har den som art, så det finnes ingen boss og ingen mål-DPS (`hasTarget: false`, navn fra mappa). Målt på eierens to logger
  18. sept 2026; `src/evtc.js` ga samme sum som en uavhengig opptelling. Condition-skade ligger på resultatkode 14 i logger,
  men på `result 0` med negativ `buffDmg` i chatbox-kanalen.
- AI mot ekte LM Studio verifiseres med `node scripts/verify-ai.js` når spillet ikke går. Ikke last modeller mens eieren spiller.
- Fiendens helse finnes IKKE i sanntid: `CBTS_HEALTHPCTUPDATE` (8), `CBTS_MAXHEALTHUPDATE` (12) og defiance bar er «realtime: no»
  i evtc-README, og ingen av dem er sett i opptakene. ArcDPS sender heller ikke rang. Boss = art-id (nedre 16 bit av `prof` for
  NPC-er, øvre halvdel 0xffff betyr gadget med flyktig id) slått opp i `data/bosses.json`; øvrig rang leses fra navnet
  (`src/modules/enemy-rank.js`). Sjekk README-ens «realtime»-linje FØR du planlegger noe som trenger en ny statechange fra broen.
- Feilsøk strømmen uten appen: en enkel UDP-lytter på 127.0.0.1:47500 (appen holder porten eksklusivt når den kjører).
  Eieren kan ta opp 3 min med «Ta opp strømmen» på Live-fanen; opptaket kan spilles inn i live.js i en test.

## 6. Underagenter (arkitekt-modellen)

- Hovedagenten er arkitekt og fletter. Underagenter jobber i egne worktrees: `git worktree add -b feat/<x> C:\Apper\gw2-wt\<x> main`,
  node_modules som junction laget fra PowerShell (`New-Item -ItemType Junction -Path <wt>\node_modules -Target <hoved>\node_modules`).
  Ikke `cmd /c mklink` fra git-bash (stien mangles og kommandoen henger).
- Gi agenten `docs/BRIEF-felles.md` pluss en oppdragsbrief (se `docs/BRIEF-guider.md` som eksempel). Krav: les
  ArcDPS-dokumentasjonen før koding, ikke push, ikke versjonsbump, sluttrapport med hva som ikke kunne verifiseres uten spillet.
- **FELLE:** `git worktree remove --force` på en worktree med junction inn i hovedtreet sletter innholdet i hovedtreet.
  Fjern junctionen først, fra PowerShell: `(Get-Item <wt>\node_modules).Delete()`, deretter `git worktree remove`.
- Fletting: tre agenter parallelt ga konflikter i live.js/overlay.js/i18n; løs med små skript, kjør `npm test`, sjekk
  at ingen `});` mangler.

## 7. Verktøyfeller i Claude Code på denne maskinen

- Bash-verktøyet halverer backslasher i heredoc-innhold og feiler på norske tegn i heredocs. Bruk Write/Edit for kode med
  regex, backslash eller æøå.
- Heredocs tolker også `\a`, `\t` osv. i innholdet (18. sept 2026 ble `...\arcdps.cbtlogs` til et bjelle-tegn og en patch feilet
  halvveis, mens `git commit` i samme kommando gikk videre). Kjed aldri commit etter et heredoc-skript uten `&&`.
- Heredocs over ca. 100 linjer kuttes. Skriv patch-skript (python) til scratchpad med Write og kjør fila.
- `capturePage` virker ikke på gjennomsiktige overlay-vinduer, og innerText beviser ikke synlighet. Verifiser med
  `getBoundingClientRect()` og `getComputedStyle(...).display` (feilrapporten har `__diag`).
- Agent-verktøyets egen worktree-isolasjon feiler her («not in a git repository»); lag worktrees selv (pkt. 6).
- LM Studio: resonneringsmodeller (Qwen3.8, Gemma 4) sender `reasoning_content`, ingen parameter slår det av, så
  token-budsjettet må være romslig. Node fetch uten strømming faller etter 5 min, derfor strømmer klienten. Last modeller med
  `lms load <id> --context-length 16384 --gpu max -y` (262k kontekst fylte hele kortet).

## 8. Hva som ikke er verifisert i ekte spill (per 18. sept 2026)

Verifisert med eierens opptak og logg 18. sept: egen direkte skade og condition-skade, egen healing, mottatt skade, dødsstøt
(value 0, result 8), kamp inn/ut på begge kanaler, kodene 67–72 og sc 18, og auto-oppdatering 0.4.2 → 0.4.4 → 0.4.5.

Fortsatt ikke verifisert (listen vedlikeholdes i «Åpent nå» i `docs/PLAN-stabilisering-2026-09-17.md`):
- Squad-lista, death log (kodene 4/5) og healing fra andre i DPS-meteret (bygd etter dokumentasjon, kun syntetiske tester).
- DPS-fanen mot en ekte EVTC-logg i nyere format (eieren har ikke slått på logging i ArcDPS).
- Alt-tab, klikk-gjennom, flere skjermer, 4K/250 % og oppdateringsvarsel under kamp etter 0.4.5-endringene.
- Lang reasoning og avbrudd mot ekte LM Studio, og et ekte AI-utdrag i Guider mot Gemini.
- Utseendet på kvitteringene fra 0.4.6 i den kjørende appen.

## 9. Stabilisering 17. september 2026

- Alle R01–R16 i `docs/REVIEW-2026-09-16.md` er implementert på stabiliseringsgrenen; full status og gjenstående spilltest står i
  `docs/VALIDERING-2026-09-17.md`. Rettelsene leveres i 0.4.5; utgivelsesnotater står i `docs/releases/0.4.5.md`.
- 232 automatiske tester; `npm run check` kontrollerer syntaks. Node 22.18.x brukes til utvikling, Electron er låst til 44.3.0.
- `npm run build:native` bygger begge Rust-delene med Cargo.lock og skriver kilde-/binærmanifest. Pakking kjører dette automatisk.
- DEMO og SHOT får hver sin `run-*`-profil i temp, uten produksjonstjenester. `scripts/smoke-electron.js` tester kilde/pakket app isolert.
- `dps.listLogs`/`parseLog` er nå asynkrone. `dps.dispose()` og `gw2.flushCache()` avventes ved avslutning. Alle nettverkskall har frist.
- Renderer bruker `Panel.lifecycle()` for montering og `Panel.saveConfig()` for synlige lagringsfeil. AI-fremdrift og avbrudd har requestId.
- Den pakkede EVTC-workeren er testet i ASAR. Ekte ArcDPS-opptak, 4K/fokus, OneDrive-bortfall og faktisk autooppdateringsinstallasjon gjenstår.
