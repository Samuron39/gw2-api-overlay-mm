# Plan for alle rettinger etter gjennomgangen

Dato: 17. september 2026. Utgangspunkt: **0.4.4**, commit `4887e3e`.

Dette er den gjeldende planen for stabilisering etter `docs/REVIEW-2026-09-16.md`. Alle 16 funn er med. Gjenstående arbeid fra `docs/PLAN-review-fixes.md` er innarbeidet i fasene og avstemt nederst. Den eldre planen beholdes som historikk; dens gamle versjonsmål styrer ikke denne planen.

Status: **Implementert og automatisk verifisert 17. september 2026, utgitt som 0.4.5.** Tillegg fra 18. september er utgitt som 0.4.6 (se «Tillegg etter 17. september» nederst). 266 tester består lokalt og i Windows-CI. Se [valideringsrapporten](VALIDERING-2026-09-17.md) for resultat per R-punkt og gjenstående spillkontroll.

Dette er den ENESTE gjeldende planen. `docs/PLAN-review-fixes.md` er avsluttet historikk med sluttstatus per punkt.

## Arbeidsregler og ferdigkriterier

- Eieren starter og stopper sin egen overlay. Agentene leser ikke produksjonskonfig fra AppData og bruker ikke appens UDP-port 47500 i tester.
- Før fase 1 er ferdig brukes rene Node-tester med `GW2_DEMO=1`, mockede tjenester og egne temp-filer. En Electron-demo skal ikke brukes som bevis på isolering før oppstartssperrene er rettet og testet.
- Én avgrenset endring per commit. Relevant regresjonstest skal vise den konkrete feilen før retting og være grønn etterpå. Hele `npm test` skal være grønn før commit og etter sammenslåing.
- Testene kontrollerer oppførsel: bevarte data, korrekt kamp, korrekt visning og opprydding. Enkle dokument- og stilendringer trenger ikke egne tester.
- Nye UI-tekster legges nederst i både norsk og engelsk språkfil. Nye/endret IPC-kanaler oppdateres i handler, preload og samsvarstest samtidig.
- Hvert punkt får separat status: **planlagt → implementert → automatisk verifisert → spillverifisert**, der spilltesting er relevant. Manglende spillopptak skal ikke hindre uavhengig implementering, men skal heller ikke skjules som «ferdig verifisert».
- Konfigmigrering skal bevare eksisterende innstillinger. Testdata og rapporter inneholder bare falske nøkler og anonymiserte spilldata.
- Underagenter som senere skriver kode bruker egne worktrees, følger AGENTS.md og får felles brief pluss en avgrenset oppdragsbrief. Hovedagenten eier sammenslåing, felles IPC/i18n og integrasjonstestene. Ingen parallelle redigeringer av samme fil uten avtalt eierskap.

## Dekning av alle 16 funn

| Funn | Retting | Fase | Status |
|---|---|---|---|
| R01 | Nyere EVTC-koder for skade og boons | 2 | Automatisk verifisert, utgitt i 0.4.5 |
| R02 | Nøkler i logger og feilrapport | 1 | Automatisk verifisert, utgitt i 0.4.5 |
| R03 | Isolert demo/testmiljø | 1 | Automatisk verifisert, utgitt i 0.4.5 |
| R04 | Konfiggjenoppretting uten overskriving | 1 | Automatisk verifisert, utgitt i 0.4.5 |
| R05 | Ukjent opplåsningsstatus ved API-feil | 2 | Automatisk verifisert, utgitt i 0.4.5 |
| R06 | Forsinket healing på riktig kamp | 2 | Automatisk verifisert, utgitt i 0.4.5 |
| R07 | AI-resultat knyttet til riktig build og utkast | 4 | Automatisk verifisert, utgitt i 0.4.5 |
| R08 | Opprydding ved fanebytte og sene svar | 4 | Automatisk verifisert, utgitt i 0.4.5 |
| R09 | Oppdateringsstatus og installeringsknapp ved åpning | 5 | Automatisk verifisert, utgitt i 0.4.5 |
| R10 | Synlighet etter endring av følg-spillet | 5 | Automatisk verifisert, utgitt i 0.4.5 |
| R11 | Umiddelbar posisjonsreset | 5 | Automatisk verifisert, utgitt i 0.4.5 |
| R12 | Aktiv boss og løpende nedtelling | 6 | Automatisk verifisert, utgitt i 0.4.5 |
| R13 | Bevare nøkkelutkast i Kom i gang | 4 | Automatisk verifisert, utgitt i 0.4.5 |
| R14 | AI-strømmefeil, JSON-svar og tidsgrenser | 3 | Automatisk verifisert, utgitt i 0.4.5 |
| R15 | Oppdatere ved første buff-stack som utløper | 2 | Automatisk verifisert, utgitt i 0.4.5 |
| R16 | Asynkront loggarkiv og parsing uten blokkering | 7 | Automatisk verifisert, utgitt i 0.4.5 |

## Fase 1 – Beskytt nøkler, konfig og testmiljø

**Mål:** Det skal være trygt å teste, lagre innstillinger og dele en feilrapport. Gjennomføres først.

**Berørte filer:** `src/main.js`, `src/config.js`, `src/log.js`, `src/ipc.js`, `src/preload.js`, `src/ai.js`, `src/windows.js`, `src/overlays.js` og oppstarts-/installasjonskall ved behov. Nye tester for konfig, logging og oppstart.

- [x] **R03:** Samle demo og skjermbildetesting under et eksplisitt isolert driftsmiljø. Velg egen userData/loggmappe og separat instanshåndtering før konfiglasting og oppstart. Automatiske tester bruker en unik temp-mappe per kjøring.
- [x] Sperr ekte spillinstallasjon, chatinnliming, Windows-oppstart, automatiske oppdateringer og normal live-port i dette miljøet. Testtjenester og porter velges eksplisitt; GUI-demo må ikke starte den ekte Mumble-hjelperen som standard.
- [x] **R02:** Innfør felles redigering av hemmelige verdier før konsoll-/fillogging og på hele rapporten før kopiering. Dette omfatter GW2-nøkkel, alle AI-nøkler, metadata, feilmeldinger og URL-er. Registreringen av hemmeligheter følger nøkkelbytte; tomme verdier må ikke føre til generell teksterstatning.
- [x] Fjern rå leverandørsvarkropper fra ordinære feilmeldinger. Behold leverandør, kanal, HTTP-status og en trygg feilårsak. Gamle logglinjer renses når rapporten bygges; originalfiler slettes ikke automatisk.
- [x] **R04:** Skill manglende konfigfil fra tilgangsfeil, ugyldig JSON og ugyldige felt. Bevar originalens eksakte byte i verifisert reservekopi før en skadet fil erstattes.
- [x] Hvis reservekopiering eller atomisk erstatning feiler: behold originalen, stans automatisk overskriving og vis vedvarende lagringsfeil. Innstillinger i minnet må ikke presenteres som lagret. Fjern direkte overskriving som reservevei etter mislykket omdøping.
- [x] Valider konfig ved lasting og `config:set`: tillatte felter, objekter/lister, endelige tall og verdiområder for vinduer, opacity og skalering. Bevar gyldige eldre innstillinger og migrer eksplisitt.
- [x] Ta med tidligere IPC-herding: sperr uønsket navigasjon/nye vinduer, kontroller avsender og argumenter ved privilegerte kanaler, og avgrens DPS-filoperasjoner til den valgte loggmappen og støttede filtyper. Test `..`, absolutte avvik og lenker/junctions som peker ut av mappen.
- [x] Fjern de ubrukte kanalene `arc:uninstall` og `app:setStartup` dersom søk bekrefter at de fortsatt ikke har brukere. Dersom avinstallasjon beholdes, må den validere spillmappe/spillstatus og ha eksplisitt håndtering av backup og bro.
- [x] Returner/avvent `openExternal` i `open:url`. Kontroller spilltilstand før chatinnliming endrer utklippstavlen.

**Akseptanse:** Mockede oppstartstester berører ingen produksjonssti, standardport eller systeminnstilling. Falske nøkler finnes verken i logg, konsoll eller rapport, også etter nøkkelbytte. Feilinjeksjon for avkortet JSON, låst fil, full disk, nektet lesing og mislykket backup/rename bevarer originalen. Test av manglende fil oppretter fortsatt korrekt førstegangsoppsett. IPC-avvik avvises før sideeffekter.

## Fase 2 – Korrekte kampdata og inventory-råd

**Mål:** Tall og anbefalinger skal svare til tilgjengelige data, også ved forsinkelse og delvise feil.

**Berørte filer:** `src/evtc.js`, `src/live.js`, `src/gw2.js`, `src/rules.js`, `src/modules/inventory.js`, tilhørende tester og anonymiserte fixtures. `bridge/src/lib.rs` endres bare dersom dokumentasjon/opptak viser behov.

- [x] **R01:** Normaliser gammelt og nyere EVTC-format før beregning. Støtt relevante buff-skaderesultater 14–18 og hendelsene 67–72 med dokumentert feltbetydning, inkludert nødvendig agentregistrering. Behold gammel formatstøtte.
- [x] Erstatt eventuell bokstavelig NUL-byte i parserkilden med en synlig JavaScript-escape uten å endre oppsplittingen av agentnavn. Dokumenter formatet mot de lokale ArcDPS-README-ene.
- [x] **R06:** Rute forsinket ekstern healing etter hendelsestid gjennom samme prinsipp som forsinket squad-skade. Oppdater korrekt nåværende/forrige kamp og øktsammendrag uten dobbelttelling. Egen healing fra flere kanaler skal fortsatt dedupliseres.
- [x] **R15:** Beregn neste oppdatering fra tidligste levende stack. Behold lengste varighet som et separat visningsmål. Gjør det samme for buffs på mål.
- [x] **R05:** Representer opplåsninger per endepunkt som kjent eller ukjent. En vellykket tom liste er kjent; nettverksfeil er ukjent. Send del-feilen til UI og AI-konteksten, og unngå «ny opplåsning»-råd når grunnlaget mangler.
- [x] Sikre at tidligere rettinger i 0.4.4 fortsatt holder: klokkeavvik, nullskade-dødsstøt, doble kampgrenser, frakobling, sen squad-skade, BUFFINITIAL og instans-ID-er.
- [x] Undersøk broens condition-/healing-klassifisering med egnet råopptak. **Spillverifisert 18. sept 2026** med eierens opptak (condition-warrior, 3 min, ArcDPS 20260915, `C:\Apper\gw2-wt\docs\opptak-2026-09-18-condi.jsonl`, ikke i repoet): egne condition-ticks kommer på chatbox-kanalen med `buff 1`, NEGATIV `buffDmg`, `iff 1`, `result 0` (124 ticks, Bleeding og Torment); healing kommer med positiv verdi og `iff 0` (61 heal-linjer). Broens regel «buff == 1 og buff_dmg > 0 = healing» er dermed riktig, og ingen broendring trengs. Avspilt gjennom `live.js` gir opptaket 278 357 i egen skade, 16 542 mottatt og 22 049 healing, likt en uavhengig opptelling av linjene.

**Akseptanse:** Gammel og nyere koding av samme syntetiske kamp gir samme skade og boon-uptime: blant annet 2300 skade, 20 % Quickness og 50 % Fury i reproen. Healing på 1200 for kamp 1 føres der både før og etter at kamp 2 starter, også når økta allerede er oppsummert. To buff-stacks med ulike utløp går fra to til én ved første utløp uten nye kampmeldinger. Feil på fargeendepunktet gir ukjent status; vellykket tom/eid liste gir fortsatt korrekte råd.

**Spillkontroll:** Eieren tar en nyere EVTC-logg og et råopptak med condition-build og healing. Anonymisering skjer før en fixture legges i repoet. Opplasting til eksterne analysetjenester gjøres bare når eieren ber om det.

## Fase 3 – Nettverk og AI som avslutter tydelig ved feil

**Mål:** Ingen operasjon skal bli stående uten appstyrt tidsgrense, og ingen feil skal se ut som et vellykket tomt AI-svar.

**Berørte filer:** `src/ai.js`, `src/gw2.js`, `src/modules/arcdps.js`, `src/modules/dps.js`, `src/modules/guides.js`, `src/modules/setup.js` og en eventuell liten felles nettverkshjelper.

- [x] Innfør en delt mekanisme for `AbortSignal`, tidsgrenser og opprydding. Migrer alle fetch-kall. Retry brukes bare der operasjonen trygt kan gjentas; ikke automatisk gjenta AI-generering eller filopplasting.
- [x] Bruk konkrete startverdier som kan justeres etter måling: 20 sekunder per vanlig API-/modellistekall, maksimalt tre ekstra forsøk for eksisterende GW2 429/5xx-flyt, og 120 sekunder for filoverføring. Håndter eventuell `Retry-After` innenfor et samlet begrenset budsjett.
- [x] For lokal AI: romslig grense for første svar og total behandling, foreslått 120 sekunder til første byte og 15 minutter totalt, med 60 sekunders inaktivitetsgrense etter oppstart. Reasoning-/heartbeat-data regnes som aktivitet. Verdiene skal være samlet og testbare, ikke spredt i klientene.
- [x] **R14:** Håndter SSE-feilobjekter, JSON-svar ut fra innholdstype, delte UTF-8-/SSE-pakker, avsluttende buffer uten linjeskift, `[DONE]`, avbrutt/trunkert svar og manglende/tomt innhold. Bevar støtte for reasoning og fjerning av think-blokker.
- [x] Gi brukeren en forståelig feil og mulighet til å avbryte/prøve igjen. Avbrytelse skal være knyttet til forespørselen, ikke kansellere andre samtidige oppgaver. En avbrutt generering må ikke lagres som et fullført svar.
- [x] Cache ArcDPS-fjernsjekksum kortvarig. La uavhengige oppsettssjekker kjøres begrenset parallelt og bevare delresultater når én tjeneste feiler.

**Akseptanse:** Falsk fetch og fake timers bekrefter at alle heng avsluttes innen konfigurert grense og rydder forbindelser/timere. HTTP 200 med SSE-feil avvises; gyldig JSON returnerer tekst; tomt eller trunkert svar er ikke suksess. Eksisterende modeller med lang reasoning kan fullføre. GW2 429/5xx, bulk-404, kansellering og delresultater testes uten nettverk.

## Fase 4 – Stabil livssyklus, riktige AI-resultater og bevarte utkast

**Mål:** Fanebytte og sene svar skal ikke lekke arbeid eller endre feil visning/build.

**Berørte filer:** `src/renderer/panel.js`, modulene `inventory`, `daily`, `timers`, `guides`, `setup`, `live`, `dps`, `settings`, `characters`, samt AI-fremdrift/IPC ved behov.

- [x] **R08:** Etabler identitet per montering og samlet opprydding av intervaller, abonnementer og avbrytbare oppgaver. `Panel.onConfig` returnerer avmeldingsfunksjon. Gjennomgå både suksess-, feil- og `finally`-grener etter asynkrone kall.
- [x] Kontroller monteringsidentitet etter venting. En ren `root != null`-test er utilstrekkelig ved åpne → forlate → åpne igjen før det gamle svaret kommer.
- [x] **R07:** Knytt AI-resultat til forespørsels-ID, build/våpensett og revisjon av utkastet. Et svar for A må ikke erstatte B; et gammelt svar for A må heller ikke erstatte en nyere redigering etter A → B → A.
- [x] Bevar fullførte Inventory-planer og karaktervurderinger i modulens tilstand, og vis dem når riktig modul åpnes. AI-fremdrift knyttes til riktig forespørsel. Ikke forkast et nyttig resultat bare fordi DOM-en er borte.
- [x] **R13:** Oppdater status i Kom i gang uten å erstatte nøkkelfeltet. Hold eventuelle hemmelige utkast bare i minnet. Definer og test bevaring ved fanebytte og språkbytte; et gammelt lagringssvar må ikke slette nyere tekst.
- [x] Gjennomgå HTML-innsettinger: escape tekst, og valider tall/enum separat før bruk i attributter eller CSS. Tomme numeriske felt bruker validert standard eller tydelig feltfeil, ikke utilsiktet 0/null.

**Akseptanse:** Test åpne/forlate/åpne med svar i motsatt rekkefølge. Etter avmontering finnes ingen modulintervaller eller abonnementer igjen og ingen fortsatte kontokall. To AI-svar og manuelle redigeringer beholder riktig utkast. Ingen lagring bruker feil build-nøkkel. Oppsettssjekk/oppstartsvalg fjerner verken skrevet nøkkel eller fokus. Mockede DOM-tester suppleres senere med isolert Electron-kontroll.

## Fase 5 – Vinduer, posisjon og oppdatering

**Mål:** Synlighet og innstillinger virker straks, og nedlastede oppdateringer vises korrekt.

**Berørte filer:** `src/windows.js`, `src/overlays.js`, `src/main.js`, `src/updater.js`, `src/ipc.js`, `src/preload.js`, `src/renderer/wheel.js`, panel og modulene `settings`/`live`.

- [x] **R10:** Skill ønsket synlighet fra midlertidig skjuling på grunn av spillstatus/fokus. Beregn effektiv synlighet ved konfigendring, spillstart/stopp, fokusendring og manuell vis/skjul. Å slå av auto-skjul/følg-spillet opphever bare den aktuelle skjuleårsaken.
- [x] Bevar manuelt skjult hjul gjennom alt-tab. Fjern foreldede skjult-statusflagg og ventende skjultimere når innstillingene endres.
- [x] **R11:** Posisjonsreset flytter eksisterende vindu umiddelbart, beregner en synlig plassering og lagrer de faktiske koordinatene. Begrens også gjenopprettede posisjoner til tilgjengelige skjermer, inkludert negative skjermkoordinater og for store vinduer.
- [x] Hjulstørrelse og skalering oppdateres uten omstart. Hjulets SVG-geometri beregnes på nytt ved relevant resize. Test faste min-/maksgrenser ved både økning og reduksjon.
- [x] **R09:** Legg til read-only `update:get` med handler/allowlist/test. Abonner på status før snapshot hentes. Bruk stigende revisjon på status eller tilsvarende ordningsgaranti, slik at et forsinket snapshot ikke overskriver nyere hendelser.
- [x] Automatisk oppdateringsvarsel skal ikke stjele fokus fra spillet. Egen brukerhandling kan åpne panelet normalt. Installeringsknappen vises også når Innstillinger åpnes etter nedlasting eller åpnes på nytt.
- [x] Håndter ny start av exe mens appen allerede kjører: vis eksisterende UI, og sørg for at prosessen som ikke fikk instanslåsen ikke fortsetter med oppstartstjenester.
- [x] Reduser arbeid fra opacity-slideren: vis endringen direkte, lagre samlet på `change` eller med debounce og en avsluttende flush. Unngå unødvendig full omtegning av hjulet.

**Akseptanse:** Mockede vinduer dekker kombinasjoner av manuell skjuling, auto-skjul og følg-spillet med spillet på/av. Reset fra `(9999,9999)` gir straks synlige koordinater. Status før/under/etter åpning, og snapshot i feil rekkefølge, viser nyeste oppdatering. Opacity/hjulstørrelse får korrekt sluttverdi uten en filskriving per musebevegelse.

**Spillkontroll:** 4K/250 %, flere skjermer, alt-tab, klikk-gjennom og oppdateringsvarsel under kamp. Eieren styrer produksjonsappens start/stopp.

## Fase 6 – Én tidsplanberegning og fullstendige data

**Mål:** I dag, Tidsplan og chatteksten skal være enige om hva som pågår og hva som starter neste gang.

**Berørte filer:** `src/modules/timers.js`, delt ren tidsplanlogikk tilgjengelig for både hovedprosess/test og renderer, `src/renderer/modules/daily.js`, `timers.js`, `src/modules/daily.js`, IPC/preload og `data`.

- [x] **R12:** Samle ekspansjon av tidsplan, aktive intervaller og neste start i én ren implementasjon med innsendt klokkeslett. Velg en enkel delingsform som virker uten Node-integrasjon i renderer; ikke kopier algoritmen inn i testen.
- [x] Bruk halvåpne intervaller: `start <= nå < slutt`. Chattekst og visning bruker samme resultat. «Pågår» betyr aktivt tidsplansegment, ikke en garanti for at bossen fortsatt lever på spillerens kartinstans.
- [x] Oppdater bossnedtelling og status lokalt mens fanen er åpen. Oppdater tekst/rader ved behov uten å ødelegge knapper, fokus og tooltips hver sekund.
- [x] Behandle videreførte segmenter over UTC-midnatt, særlig Dragon's Stand. Test kontinuitet på begge sider av døgngrensen.
- [x] Erstatt Tidsplans fulle `daily:get` for drept-merker med et lett oppslag av worldboss-status, med cache og én pågående forespørsel. Samle også samtidige kartnavnoppslag i hjulet.
- [x] Finn alle manglende waypoint-oppslag i dagens data, fyll dem fra offisielt API/wiki, behold lisens/kilde og test alle tidsplaner. Ikke hardkod den gamle opptellingen på 11 mangler som fasit.
- [x] Verifiser Drakkar-dekning og riktig API-id, samt material-ID/tier for Iron Ore. Ukjent profesjon skal gi tydelig «ukjent» fremfor Guardian-skills. Guide-waypoints kontrolleres og får eksplisitt fallback der fullstendig oppslag ikke finnes.

**Akseptanse:** Admiral Taidha Covington er aktiv ved 00:01 UTC i segmentet 00:00–00:15. Begge moduler og chattekst skifter korrekt ved segmentstart/slutt og midnatt. En nedtelling endrer seg uten API-kall. Waypoint-testene dekker hele datasettet og rapporterer konkrete mangler. Datakorreksjoner bekreftes mot kilde ved implementering.

## Fase 7 – Respons, bygg og samlet verifisering

**Mål:** Store logger skal ikke holde hovedprosessen opptatt, og utgivelser skal være repeterbare og kontrollerte.

**Berørte filer:** `src/modules/dps.js`, `src/modules/characters.js`, `src/modules/setup.js`, `src/ipc.js`, `src/windows.js`, `src/gw2.js`, `src/mumble.js`, eventuell EVTC-worker under `src`, byggskript, tester, pakke-/låsefiler og CI.

- [x] **R16:** Gjør loggindeksering asynkron med cache og begrenset parallellitet. Returner de nyeste loggene uten å anta at brukeren har én bestemt mappestruktur. Flytt dekomprimering og parsing til worker.
- [x] Migrer alle kallere samlet: `dps:list`, `dps:parse`, watcher, oppsettssjekk og karaktervurdering. Håndter worker-feil, kansellering, fil som fortsatt skrives, samtidige parse-kall og begrenset cache/kø.
- [x] Gjenopprett loggwatcher etter `error` og mappe som forsvinner/kommer tilbake, med begrenset backoff. Ved mappebytte ryddes gamle timere, watcher og sene svar.
- [x] Debounce og asynkroniser item-cache-skriving. Serialiser skrivinger slik at en eldre snapshot ikke overskriver en nyere, og håndter avslutning uten å miste siste gyldige cache.
- [x] Gi Mumble-hjelperens restart begrenset eksponentiell backoff. Planlagt stopp skal avbryte ventende restart; normal avslutning og oppstartsfeil skal ha tydelig, testet oppførsel.
- [x] Lås Electron til den versjonen som faktisk valideres sammen med låsefilen. Angi støttet Node-versjon og kontroller at testkjøringen faktisk finner tester. Ikke velg versjon blindt fra den eldre planen.
- [x] Gjør native-bygg reproduserbare. Foretrekk nytt bygg før release eller et byggmanifest med kilde-/Cargo.lock-fingeravtrykk; rene mtime-sjekker kan gi falske utslag etter checkout. Bygg både hjelper og bro før pakking.
- [x] Legg inn Windows-CI med installasjon fra låsefil, tester, syntaks-/IPC-/i18n-kontroll og native-bygg der verktøykjeden finnes. Publisering holdes utenfor vanlig test-CI.
- [x] Rett svake tester fra eldre plan: faktisk oversatt action-label fremfor sann fallback, og språkreset i `t.after`. Suppler AI/GW2/config/IPC med meningsfulle regresjonstester fra fasene over.
- [x] Oppdater README-ene, AGENTS-status og felles underagentbrief. Fjern gjenværende uriktig påstand om at ArcDPS-kodene ligger én under README-ordinalene. Dokumenter reelle begrensninger og testdekning.

**Akseptanse:** Benchmark med et syntetisk arkiv på minst 10 000 loggoppføringer og store EVTC-filer måler før/etter for hovedprosessens event-loop-forsinkelse, IPC-responstid, minne og total behandlingstid. Operasjonene skal la en kontrollert heartbeat/IPC svare under arbeid; terskler fastsettes og logges ut fra samme testmiljø før ytelsesendringen, ikke som udokumenterte FPS-løfter. Cache-/watcher-/worker-tester bekrefter at gamle oppgaver ikke oppdaterer et nytt mappevalg. Installeringspakken inneholder nybygde native-filer og kan testes isolert.

## Rekkefølge, parallellisering og levering

Standard rekkefølge er **1 → 2 → 3 → 4 → 5 → 6 → 7**. Sikker testisolering er forutsetning for Electron-integrasjonstester. Fase 4s livssyklus må være på plass før fase 5s updater-UI. Fase 2s parserkontrakt holdes stabil når fase 7 flytter parsing til worker.

Uavhengig arbeid kan fordeles for å spare tid: EVTC/live og UI-planlegging kan gå parallelt etter avklart isolering; tidsplanlogikk kan utvikles separat. Endringer i `gw2.js`, `ipc.js`, `main.js`, språkfilene og rendererens Live-modul må ha én avtalt eier om gangen. Ikke parallelliser bare for å fylle agentplasser.

Lever i små commits, og samle eventuelle utgivelseskandidater slik:

1. **Beskyttelse og datakorrekthet:** fase 1–2. Prioriteres først; ingen grunn til å vente på alle UI-forbedringene før disse kan testes.
2. **Nettverk og brukerflyt:** fase 3–6.
3. **Ytelse og bygg:** fase 7 og samlet regresjonskontroll.

Versjonsnummer fastsettes mot siste faktiske utgivelse når en kandidat er klar. Planoppgaven gjør ingen commits, versjonsbump, push eller publisering. Ved senere utgivelsesarbeid følges AGENTS.md for commit-identitet, bygg, GitHub-utkast og kontroll av `latest.yml`. Dersom broen endres, må eieren få tydelig beskjed om å installere ny bro via Live-fanen.

Etter hver fase leveres: endrede filer/commits, testresultat, hvilke R-punkter som er automatisk verifisert, og en kort liste over konkret spillkontroll som gjenstår. Feiloppdagelser i én fase utvider ikke automatisk produktets funksjonsomfang.

## Avstemming mot planen fra 14. september

Henvisningene under er til fase/punkt i `docs/PLAN-review-fixes.md`. Eldre punkter som ikke ble reprodusert i den nye reviewen kontrolleres mot koden før endring; de er ikke automatisk bekreftede feil.

| Eldre punkt | Håndtering i denne planen |
|---|---|
| Fase 1, punkt 1–8 | Rettet i 0.4.4 ifølge commit og gjennomgang; behold regresjonsdekningen i fase 2. Ingen ny omskriving uten feilbevis. |
| Fase 1, punkt 9 | Dokumentasjonsrester kontrolleres i fase 7; felles brief har fortsatt feil ordinalpåstand. |
| Fase 2, punkt 1–2 | EVTC-format og NUL i fase 2. |
| Fase 2, punkt 3 | Broens condition/healing-regel: dokumentert undersøkelse og spillopptak i fase 2. |
| Fase 2, punkt 4–5 | Asynkrone logger og watcher-gjenoppretting i fase 7. |
| Fase 3, punkt 1–2 | Konfigbevaring og validering i fase 1. |
| Fase 3, punkt 3–4 | Tidsgrenser og AI-formater i fase 3. |
| Fase 3, punkt 5–10 | Navigasjon, filstier, ubrukte kanaler, loggrensing, URL og utklippstavle i fase 1. |
| Fase 3, punkt 11–12 | Hjelper-backoff og item-cache i fase 7. |
| Fase 3, punkt 13 | Enkeltinstans og gjenåpning i fase 5; testisolering håndteres allerede i fase 1. |
| Fase 4, punkt 1–5 og 11 | Livssyklus, avmelding, skjema og bevarte AI-resultater i fase 4. |
| Fase 4, punkt 6 og 12–13 | Aktiv boss, skånsom tidsoppdatering og samling av kartkall i fase 6. |
| Fase 4, punkt 7–10 | Opacity, hjulstørrelse, manuell synlighet og fokus ved oppdatering i fase 5. |
| Fase 4, punkt 14–15 | HTML-innsetting og numerisk validering i fase 4, med grunnvalidering i fase 1. |
| Fase 5, punkt 1–3 og 8 | Timer-/waypoint-/material-/profesjonsdata i fase 6, etter kontroll mot kilder. |
| Fase 5, punkt 4–7 | Regresjonstester og bygg i respektive faser; svak testlogikk, CI og samlede byggkrav i fase 7. |

## Endelig sjekkliste før arbeidet kalles ferdig

- [x] Alle R01–R16 er implementert og automatisk verifisert, eller et konkret avvik er dokumentert og avklart.
- [x] Alle punkter fra den eldre planen har enten verifisert retting, dokumentert «allerede rettet/ikke feil», eller tydelig gjenværende status.
- [x] Ingen regresjon i eksisterende tester; IPC og språkfiler er i samsvar.
- [x] Demo og skjermbildetesting er isolerte også når en simulert produksjonsinstans kjører.
- [x] Ekte logger/opptak og 4K/250 %-testen er gjennomført, eller funksjonene står uttrykkelig som ikke spillverifisert. Automatisk test og spilltest rapporteres hver for seg.
- [x] Installerings- og oppdateringsflyten: ikke prøvd på en egen testinstallasjon, men eierens egen logg (feilrapport 18. sept 2026) viser hele løpet på den ekte installasjonen: 0.4.2 → 0.4.4 → 0.4.5 med differensiell nedlasting, `quitAndInstall` og ny start på under ett minutt, og sjekk ved spillstart. 0.4.5 → 0.4.6 gjenstår å se.
- [x] Rapportene har ingen hemmeligheter, og konfiggjenoppretting bevarer originaldata ved feil.
- [x] Dokumentasjon, teststatus og eventuelt krav om ny bro er oppdatert før utgivelse.

## Tillegg etter 17. september

| Dato | Punkt | Status |
|---|---|---|
| 18. sept | **T01 Synlig kvittering ved knappene.** `Panel.busy()`, `Panel.note()`, `Panel.arcProgress()`; ekte fremdriftslinje for ArcDPS-nedlasting (`arc:progress`); «allerede oppdatert» når broen er identisk; nøytral «venter på at spillet starter» i stedet for rød feil. | Automatisk verifisert, utgitt i 0.4.6. Utseende i appen (4K/250 %) gjenstår. |
| 18. sept | **T02 Antivirus fjerner ArcDPS.** Windows Defender fjernet offisiell `d3d11.dll` (build 20260915) som `Trojan:Win32/Posilod.CA!cl`. `verifyKept()` etter installasjon (kode `AV_REMOVED`), `status().removedExternally`, advarsel i Live, DPS og Kom i gang. Appen og agenter endrer aldri antivirus-innstillinger. | Automatisk verifisert, utgitt i 0.4.6. |
| 18. sept | **T03 CI-feil fra T02-testen.** `arcdps.js` lastet `electron`-pakken i ren Node og startet en Electron-nedlasting midt i testkjøringen. Laster nå bare når `process.versions.electron` finnes. | Rettet i `3cc24dd`, CI grønn. `src/modules/dps.js:13` og `skills.js:27` gjør det samme inne i try/catch; ufarlig i dag, men bør få samme vakt. |
| 18. sept | **T04 Opptak med condition-build.** Se fase 2. Bekrefter også i ekte spill: dødsstøt har value 0 og result 8 (5 av 5), kamp inn/ut kommer på begge kanaler (7 + 7), kodene 67–72 og sc 18 brukes som dokumentert. | Spillverifisert. |

## Ny funksjon: spillerliste med detaljer i DPS-meteret (ønsket av eieren 18. sept 2026)

Ønsket: se navn og DPS/skade for alle i gruppa, trykke på en person for detaljer inne i meteret med rask vei tilbake,
HPS ved siden av DPS, og kunne velge nåværende mål, tidligere fiender eller alt samlet. Bosser og eliter særlig merket.

**Trinn 1 (ingen broendring). Ferdig og automatisk verifisert 18. sept 2026, utgitt i 0.4.8; ikke sett i spillet ennå.** Broen sender alt hvert treff fra de andre i squaden (skill, mål, mengde); `live.js` kastet detaljene.
- [x] `src/live.js`: regnskap per spiller → per mål → per skill (`detail`) for deg, egne minioner og squaden; foldes inn i økta.
- [x] `live.detail({ period, player, target })` og kanalen `live:detail`: spillerliste (skade, DPS, andel, healing, HPS), mål-liste
      for perioden (nåværende mål merket), og detaljer for én spiller (skills, mål; for deg selv også mottatt og healing).
      Hentes ved behov, så den faste `live:state`-strømmen til vinduene ikke vokser.
- [x] Overlay: squad-visningen blir en klikkbar spillerliste; klikk åpner detaljer i samme vindu med «◂ Tilbake»; ny knapp i
      verktøylinja blar mål: alle → nåværende → fiendene i perioden. Rader er klikkbare også når vinduet er låst (samme teknikk
      som verktøylinja). Klikk på et mål i detaljvisningen velger det målet.
- [x] Tester for regnskapet, målfilteret, økta og kanalen. Overlay-tegningen testes nå også: `test/overlay-players.test.js` kjører selve `overlay.js` mot en minimal DOM (liste, klikk, tilbake, målvalg, klikk-gjennom). Utseende og klikk i den ekte, gjennomsiktige ruta må eieren se på.

Kjente grenser (målt, se AGENTS.md del 5): andres skade kommer 2–3 s forsinket; utenfor instanser bare squaden i nærheten;
andres healing krever «arcdps healing stats» med deling på. DPS per mål regnes over hele kampens varighet.

**Trinn 2. Ferdig og automatisk verifisert 18. sept 2026, utgitt i 0.4.9, UTEN ny bro.** Den opprinnelige reserveplanen (maks
helse fra broen) viste seg umulig: evtc-README merker `CBTS_MAXHEALTHUPDATE`, `CBTS_HEALTHPCTUPDATE` og `CBTS_DEFIANCEBARSTATE`
med «realtime: no», og ingen av dem finnes i eierens to opptak, selv om broen videresender alle andre statechange-koder. ArcDPS
sender heller ikke rang. Det som faktisk finnes i strømmen ble brukt i stedet:
- [x] `data/bosses.json`: 81 art-id-er for raid-, strike- og fractal-bosser, Soo-Won og treningsgolemene, kuratert fra Elite
      Insights sin `SpeciesIDs.cs` (MIT), bare selve bossene. Art-id er nedre halvdel av `prof` for NPC-er (README: «reliable id»).
      Gadget-bosser (Conjured Amalgamate, Dragonvoid) er ute fordi gadgets har flyktig pseudo-id.
- [x] `src/modules/enemy-rank.js`: boss fra art-id, ellers rangordet i navnet (Veteran, Elite, Champion, Legendary; også tysk,
      fransk og spansk). **Ikke sett i et opptak ennå** at ArcDPS-navnet inneholder rangordet; står det ikke der, merkes fienden ikke.
- [x] Mål-lista: ★ boss, ◆ legendary/champion, ◇ elite, ▪ veteran; bosser og champions står først. Nytt filter «Mål: bosser»
      (champion og opp) tilbys når perioden har en slik fiende. Nåværende mål i `live:state` har `rank`/`rankKey`.
- [x] Målvinduet (target-overlayen) har fått en navnelinje med rangmerke øverst (0.4.10), også uten conditions. Kan slås av med
      `showTargetName` (Live-fanen). Eksisterende vinduer som er akkurat én ikonrad høye må dras litt høyere av eieren.

Verifisering av begge trinn krever et squad-opptak fra eieren (samme som punkt 2 under).

### Åpent nå (i prioritert rekkefølge)

1. ~~Anonymisert regresjonsfixture fra opptaket 18. sept.~~ **Ferdig 18. sept:** `scripts/anonymize-recording.js` (bytter spiller- og kontonavn, nekter å skrive hvis et navn lekker i et annet felt), `test/fixtures/live-condi-2026-09-18.jsonl.gz` (41 kB) og `test/live-replay.test.js`, som teller linjene uavhengig og krever samme summer fra `live.js` (278 357 / 16 542 / 22 049, 7 kamper) og at hvert dødsstøt tømmer målet. Nye opptak (squad, død, healing fra andre) legges inn på samme måte.
2. **Eierens spillkontroll** fra valideringsrapporten: alt-tab og klikk-gjennom, flere skjermer, 4K/250 %, varsel under kamp, squad-lista, dødsloggen (kodene 4/5) og healing fra andre. Ingen av disse er dekket av opptaket (solo, ingen død).
3. ~~Ekte EVTC-logg i DPS-fanen.~~ **Spillverifisert 18. sept (R01):** eieren slo på logging, og to ekte `.zevtc` (build 20260915, revisjon 1, condition-warrior) gir i `src/evtc.js` nøyaktig samme sum som en uavhengig opptelling av rå-hendelsene: 214 290 og 289 641, der condition-skaden (99 853 og 158 958) ligger på resultatkode 14. **Nytt funn, rettet i `5b29efb` (utgitt i 0.4.7):** i åpen verden logger ArcDPS hele kartet, id-en er kart-id og ingen agent er boss; fanen viste «Boss 1640». Nå brukes mappenavnet («Deeper Revelations Leyspring Hollows»), `hasTarget: false` følger med, og karaktervurderingen sier ikke lenger «DPS mot boss: 0». En ekte BOSS-logg (raid, strike eller fractal) med flere spillere er fortsatt ikke sett.
4. **AI mot ekte leverandør:** ikke kjørt, fordi spillet gikk og LM Studio-serveren var av (agenten laster ikke en modell på skjermkortet mens eieren spiller). Gjort klart som én kommando: `node scripts/verify-ai.js` (svar med resonnering, avbrudd midt i strømmen, ekte guide-utdrag fra wikien; ingen nøkler, leser ikke appens konfig). Gemini krever eierens nøkkel og testes av eieren i Guider-fanen.
5. **Oppgradering 0.4.5 → 0.4.6** på eierens maskin, og utseendet på kvitteringene.
6. ~~Små ting.~~ **Ferdig 18. sept i `5b29efb` (utgitt i 0.4.7):** `electron`-vakten er lagt inn i `dps.js` og `skills.js`. Veiviseren: `setup.isComplete()` avgjør om alt påkrevd er på plass (ingen røde steg), og `setup:check` setter da `setupDone` selv, så Kom i gang ikke åpner seg ved hver start. Avhukingen virker som før.
