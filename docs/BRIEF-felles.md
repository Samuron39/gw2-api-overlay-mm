# Felles oppdragsbrief for underagenter, GW2 Overlay

Du jobber i en egen git-worktree (angitt i oppdraget ditt) på en egen gren. Hovedtreet i `C:\Apper\Gw2 overlay` skal du IKKE røre.
Arkitekten (hovedagenten) slår sammen grenene etterpå. Skriv kode som er lett å slå sammen: nye blokker med tydelig
kommentaroverskrift, ikke omskriving av eksisterende kode du ikke trenger å endre.

## Prosjektet i korte trekk
- Electron-app (`npm start`), hovedprosess i `src/`, renderer i `src/renderer/`. Norske kommentarer, norsk bokmål er
  standardspråk. ALLE tekster i UI-et går via i18n: `src/i18n/nb.json` og `src/i18n/en.json` må ha samme nøkler
  (testen `test/i18n.test.js` håndhever det). Legg nye nøkler til NEDERST i begge filene.
- Tester: `npm test` (node:test). Skriv tester for ny logikk i `test/`. `test/live.test.js` viser hvordan man sender
  syntetiske hendelser over UDP til `src/live.js` og leser `snapshot()`.
- ArcDPS-broen: `bridge/src/lib.rs` (Rust, cdylib, arcdps-crate 0.11.2 med håndskrevet eksport). Bygg med
  `cargo build --release` i `bridge/`. Den sender JSON-linjer over UDP til 127.0.0.1:47500, protokollen står i
  toppen av `lib.rs`. `src/live.js` mottar, tolker og bygger tilstanden (`snapshot()`), som sendes til
  overlay-vinduene (`src/renderer/overlay.js`, `overlay.html`) og panelet (`src/renderer/modules/live.js`, `dps.js`).
- Overlay-vinduer defineres i `src/overlays.js` (DEFAULTS per type), innstillingene deres vises på Live-fanen
  (`src/renderer/modules/live.js`, lista `WIN`), og tegnes i `overlay.js` (`render()` velger etter `TYPE`).
  DPS-vinduet (`TYPE === 'dps'`, `renderDps()`) er der du skal legge til visning.

## ArcDPS: LES DOKUMENTASJONEN FØR DU KODER
- `C:\Apper\gw2-wt\docs\arcdps-api-README.txt`: utvidelses-API-et (callbacks `combat` og `combat_local`, `ag`-struct).
- `C:\Apper\gw2-wt\docs\arcdps-evtc-README.txt`: `cbtevent`-feltene, `cbtstatechange`, `cbtresult`, `cbtbuffremove`,
  `cbtanimation`, `iff`. README-ordinalene i `cbtstatechange` samsvarer NØYAKTIG med det broen mottar (CBTS_COMBAT = 0):
  67 ANIMATIONSTART, 68 ANIMATIONSTOP, 69 BUFFAPPLY, 70 BUFFCHANGE, 71 BUFFREMOVE_SINGLE, 72 BUFFREMOVE_ALL.
- `C:\Apper\gw2-wt\docs\opptak-2026-09-13.log`: EKTE opptak av broens strøm (ankomst-ms TAB json per linje) fra en
  kamp i åpen verden, tatt med bro-versjonen fra 0.2.4 (område-kanalen droppet da vanlige treff med sc 0). Bruk den
  til å se hvordan feltene faktisk ser ut.
- Målt fakta (13. sept 2026, ArcDPS build 20260816):
  - `combat_local` («chatbox events») er sanntid, men gir bare skadetreff, condition-ticks (buff=1, buffDmg!=0, value=0),
    kamp inn/ut (sc 1/2) og logg start/slutt (sc 9/10). Skade fra chatbox-kanalen er NEGATIVE tall (value -698).
  - `combat` (område/evtc) har alt annet (buffs, aktiveringer, andres hendelser), men kommer 2–3 s forsinket.
    «evtc: limited to squad outside instances» i README betyr: utenfor instanser får du andres hendelser bare når de er
    i squaden din.
  - Målbytte: ev == null, src.elite == 1, src.id = nytt mål. Agent lagt til: ev == null, src.prof != 0, src = id/navn,
    dst = prof/elite/self/kontonavn. Agent fjernet: ev == null, src.prof == 0.
  - Dødsstøt: `result` 8 (CBTR_KILLINGBLOW). Ingen CHANGEDEAD for vanlige fiender i åpen verden.
- Siter README-linjene du bygger på i kodekommentarene (feltnavn og betydning), så neste person slipper å gjette.

## Regler
- Ikke bryt eksisterende tester. Kjør `npm test` og `npm run check` før du leverer; native-endringer bygges med `npm run build:native`.
- Demo/SHOT bruker unike temp-profiler og ingen spilltjenester. Start/stopp aldri eierens app. Bruk dynamisk port i UDP-tester.
- `dps.listLogs` og `dps.parseLog` er asynkrone. Husk `signal` og opprydding. Renderer bruker monteringsidentitet fra `Panel.lifecycle()`;
  alle sene svar må sjekke riktig montering, mens nyttige AI-resultater beholdes per forespørsel/build. `Panel.saveConfig` viser lagringsfeil.
- Ikke endre `package.json`-versjonen, ikke lag utgivelser, ikke push. Commit på din gren med
  `git -c user.name=Samuron39 -c user.email=illusiveman662@gmail.com commit`, avslutt meldingen med
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Hold deg til oppdraget ditt. Ting du oppdager utenfor det: skriv dem i sluttrapporten, ikke fiks dem.
- Sluttrapport (i svaret ditt): hva du bygde, hvilke filer, hvilke README-linjer du støtter deg på, hva som IKKE kunne
  verifiseres uten spillet (vi kan ta opp strømmen i spillet etterpå), og eventuelle tvil.
