# Stabilisering – resultat og gjenstående spillkontroll

Dato: 17. september 2026. Utgangspunkt `4887e3e` (0.4.4). Arbeidsgren `codex/stabilisering-20260917`.

Alle 16 kodefunn i gjennomgangen er rettet, med regresjonsdekning. Arbeidet omfatter også tilleggspunktene i den godkjente planen: IPC/navigasjon, tidsgrenser, cache, loggwatcher, Mumble-restart, native-bygg, CI og dokumentasjon. Versjon 0.4.4 er beholdt. Ingen push, publisering eller installering over eierens app er utført. Broens kildekode/protokoll er uendret.

## Hva som er rettet

| Funn | Resultat | Automatisk kontroll |
|---|---|---|
| R01 | Gammel og nyere EVTC-koding gir samme skade/boon-data; NUL i kildefilen er erstattet med synlig escape. | Syntetiske EVTC-varianter; 2300 skade, 20 % Quickness, 50 % Fury. |
| R02 | Felles rensing før logg/konsoll og ved rapport; gamle, nye, kodede og URL-baserte nøkler håndteres. | Falske nøkler i logg, konsoll og historikk. |
| R03 | Unik temp-profil og sessionData for både DEMO/SHOT; ingen instanslås, spillhjelper, live-UDP, watcher, tray, hurtigtast eller updater i testmodus. | Oppstartsmocker og to faktiske Electron-smoketester. |
| R04 | Original konfig bevares før reparasjon. Lese-/backupfeil blokkerer overskriving. Felt valideres; gyldige naboer og eldre rotasjoner bevares. | Skadet JSON, ENOSPC, EACCES, EPERM, ugyldige felt og ny installasjon. |
| R05 | Mislykkede unlock-oppslag er ukjente; ikke «ny opplåsning». UI/AI får delfeil, item beholdes foreløpig. | Tom/eid/ukjent liste og feil per endepunkt. |
| R06 | Forsinket healing føres på kampen hendelsen tilhører, også etter neste kamp/øktsoppsummering. | Forsinkede syntetiske heal-hendelser og deduplisering. |
| R07 | AI-forslag tilhører forespørsel, build/våpensett og utkastets revisjon. Sene forslag overskriver ikke nyere redigering. | A→B→A, motsatt svarrekkefølge og avbrutt eldre kall. |
| R08 | Montering eier intervaller/abonnementer; sene svar sjekker identitet. Fullførte AI-planer/vurderinger beholdes. | Mock-DOM, cleanup og fanebytte i Electron. |
| R09 | `update:get` og status med stigende revisjon; innstillinger kan hente nedlastet status ved gjenåpning. | Snapshot/hendelse i feil rekkefølge; updater-kopi og revisjon. |
| R10 | Ønsket synlighet er skilt fra auto-skjul/følg-spillet; eksplisitt visning og manuelt skjul bevares. | Vindusmocker og rene synlighetsregler. |
| R11 | Reset flytter eksisterende overlay og lagrer faktisk posisjon. Hjulet beregner geometri på nytt og begrenses til skjermen. | Reset fra utenfor skjerm, negative skjermer, vekst/krymping og fokus. |
| R12 | I dag, Tidsplan og chat bruker samme UTC-beregning med halvåpne intervaller og midnattskontinuitet. | Taidha 00:01, grenseverdier, Dragon's Stand, Drakkar og stabil DOM under nedtelling. |
| R13 | Nøkkelfelt/utkast beholdes ved status- og språkbytte; lagringsfeil vises og tømmer ikke utkast. | Fokusnode, nytt utkast under lagring og avvist lagring. |
| R14 | AI håndterer SSE/JSON, delte pakker, sluttbuffer, feil, tomme/trunkerte svar, avbrudd og tidsgrenser. | Falsk fetch/tid, cleanup og uavhengig kansellering per avsender/forespørsel. |
| R15 | Tidligste levende stack styrer neste oppdatering; lengste varighet brukes fortsatt til visning. | To stacks går til én uten nye hendelser, også på mål. |
| R16 | Asynkron loggindeks, worker-parsing, avgrenset kø/cache, stabil fil før parsing og watcher-gjenoppretting. | 10 000 filer, ekte workers, avbrudd, mappebytte, fil under skriving og pakket ASAR-worker. |

Ytterligere rettinger: alle fetch-kall har appstyrt frist; AI har 120 s første byte, 60 s inaktivitet og 15 min totalgrense. Vanlige API-kall har 20 s, overføring 120 s. ArcDPS-sjekksum caches. Oppsett kjører høyst tre sjekker samtidig. Item-cache skrives asynkront/serialisert og flushes ved avslutning. Mumble har 2/4/8/16/32 s restart og stopper etter fem mislykkede omstarter; 30 s stabil kjøring nullstiller telleren. Planlagt stopp avbryter restart.

IPC godtar bare kjente lokale hovedrammer. Navigasjon/nye vinduer avvises. EVTC-stier må ligge under valgt mappe etter reelt filoppslag, også ved junction. Ubrukte `arc:uninstall`/`app:setStartup` er fjernet. Eksterne URL-er avventes, og chat sjekker spillstatus før utklippstavlen endres.

## Målt verifisering

- `npm test`: **232 bestått, 0 feil**, opp fra 139. Alle filer oppdages eksplisitt; tom testliste gir feil. Ingen ekte konto- eller AI-kall i testen.
- `npm run check`: **94 JavaScript-filer** uten syntaksfeil. IPC-allowlist, språkfiler og plassholdere kontrolleres av testene.
- `npm run build:native`: både hjelper og bro bygd med `--release --locked`. Manifest kontrollerer kilde, Cargo.lock og binærhash; mtime brukes ikke.
- Electron **44.3.0** er låst i package-/låsefil og faktisk brukt i begge smoketestene. Node **22.18.0** brukes til verktøy/tester; Electron har sin egen innebygde Node-versjon.
- `npm run dist:installer`: NSIS-pakke, blockmap og utpakket app bygd lokalt. Ingen signeringsinformasjon var konfigurert; pakken er usignert som tidligere.
- `node scripts/smoke-electron.js` og `--packaged`: begge bestått. Norsk språk, konfiglagring, fem faner, 1 syntetisk EVTC-logg med **200 000 skade**, worker, updater-teststatus og blokkert spillinnliming. Ingen renderer-/hovedprosessfeil. Skjermbilde kontrollert; faktiske DOM-høyder er positive.
- Windows-CI er lagt til, men er **ikke kjørt på GitHub** siden endringene ikke er pushet.

Den første Electron-kjøringen i sandkassen feilet ved oppstart av renderer/GPU. En ny, uttrykkelig isolert test utenfor sandkassen passerte. Temp-profil ble bekreftet i loggen; eierens produksjonskonfig ble ikke lest. De mislykkede testprosessene ble identifisert og ryddet separat.

### Ytelse

`test/benchmark-log-archive.js` sammenligner 0.4.4 med ny implementasjon i samme Windows-/Node 22.18-miljø. 10 000 loggfiler, én million hendelser; 61 MiB ukomprimert og 2,2 MiB komprimert. «IPC-puls» er meldinger fra en separat worker, ikke en FPS-måling i spillet.

| Måling | Før | Etter |
|---|---:|---:|
| Lengste hovedtrådsstans, indeks | 248 ms | 16 ms |
| Lengste hovedtrådsstans, parsing | 388 ms | 20 ms |
| Lengste IPC-pulsforsinkelse | 248–388 ms | 1 ms |
| Total indekstid | 248 ms | 176 ms |
| Total parsetid | 388 ms | 448 ms |

Responsmålet 124 ms ble fastsatt fra baseline i samme kjøring og bestått. RSS ble målt sekvensielt til 140–288 MiB; resultatet dokumenterer ikke redusert minnebruk. Workers gir bedre respons, men har oppstartskostnad.

## Data og eldre plan

Alle tidsplan-waypoints har oppslag. Ni manglende oppføringer er hentet fra ArenaNets API. Drakkar er koblet til riktig API-id; ukjent profesjon gir feil i stedet for Guardian-data. Kilder og fallback for guide-waypoints står i `data/SOURCES.md`.

Iron Ore 19699 i både T2/T3 er kontrollert og beholdt som tilsiktet estimat. Tidligere 0.4.4-rettinger for klokkeavvik, dobbeltlevering, nullskade-dødsstøt, frakobling, BUFFINITIAL og instans-ID-er beholdes og dekkes av eksisterende tester. Ordinalfeilen i underagentbriefen er rettet. Ingen nye fortegnsregler er antatt for broens condition/healing; egnet råopptak mangler fortsatt.

## Gjenstår før en spillverifisert utgivelse

1. Nyere ekte EVTC og anonymisert opptak med condition-build, healing, squad og death log. Syntetiske tester beviser ikke at alle kombinasjoner i ArcDPS-strømmen er dekket.
2. Eieren tester alt-tab, klikk-gjennom, manuell vis/skjul, flere skjermer og 4K/250 % i sin spilløkt. Varsel under kamp skal ikke stjele fokus.
3. Avbryt/lang reasoning mot faktisk LM Studio og valgfri sky, samt ekte guide-utdrag. Tidsgrenser og protokollvarianter er foreløpig testet med mockede leverandører.
4. Reelt OneDrive-/nettverksmappebortfall og kontinuerlig loggskriving under spill.
5. Separat testinstallasjon og faktisk oppgraderingsløp fra publisert versjon, inkludert installering etter nedlasting. NSIS-bygg og pakket app er verifisert; installasjon, registry-integrasjon og autooppdatering er ikke gjennomført.

Produksjonsappen er ikke startet/stoppet av arbeidet, og spillets filer er ikke endret. Broen trenger ingen protokolloppgradering fra disse rettingene. En senere utgivelse må få eget versjonsnummer og følge AGENTS.md.
