# Plan for alle rettinger etter gjennomgangen

Dato: 17. september 2026. Utgangspunkt: **0.4.4**, commit `4887e3e`.

Dette er den gjeldende planen for stabilisering etter `docs/REVIEW-2026-09-16.md`. Alle 16 funn er med. Gjenstående arbeid fra `docs/PLAN-review-fixes.md` er innarbeidet i fasene og avstemt nederst. Den eldre planen beholdes som historikk; dens gamle versjonsmål styrer ikke denne planen.

Status: **Implementert og automatisk verifisert 17. september 2026.** 232 tester består; kilde- og pakket Electron-app består isolert smoketest. Se [valideringsrapporten](VALIDERING-2026-09-17.md) for resultat per R-punkt og gjenstående spill-/installasjonskontroll.

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
| R01 | Nyere EVTC-koder for skade og boons | 2 | Planlagt |
| R02 | Nøkler i logger og feilrapport | 1 | Planlagt |
| R03 | Isolert demo/testmiljø | 1 | Planlagt |
| R04 | Konfiggjenoppretting uten overskriving | 1 | Planlagt |
| R05 | Ukjent opplåsningsstatus ved API-feil | 2 | Planlagt |
| R06 | Forsinket healing på riktig kamp | 2 | Planlagt |
| R07 | AI-resultat knyttet til riktig build og utkast | 4 | Planlagt |
| R08 | Opprydding ved fanebytte og sene svar | 4 | Planlagt |
| R09 | Oppdateringsstatus og installeringsknapp ved åpning | 5 | Planlagt |
| R10 | Synlighet etter endring av følg-spillet | 5 | Planlagt |
| R11 | Umiddelbar posisjonsreset | 5 | Planlagt |
| R12 | Aktiv boss og løpende nedtelling | 6 | Planlagt |
| R13 | Bevare nøkkelutkast i Kom i gang | 4 | Planlagt |
| R14 | AI-strømmefeil, JSON-svar og tidsgrenser | 3 | Planlagt |
| R15 | Oppdatere ved første buff-stack som utløper | 2 | Planlagt |
| R16 | Asynkront loggarkiv og parsing uten blokkering | 7 | Planlagt |

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
- [x] Undersøk broens condition-/healing-klassifisering med egnet råopptak. Ikke endre fortegnsregler på antakelse. Manglende opptak føres som et eget uverifisert punkt, og øvrig arbeid fortsetter.

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
- [ ] Installerings- og oppdateringsflyten er prøvd på en testinstallasjon uten å styre eierens kjørende overlay.
- [x] Rapportene har ingen hemmeligheter, og konfiggjenoppretting bevarer originaldata ved feil.
- [x] Dokumentasjon, teststatus og eventuelt krav om ny bro er oppdatert før utgivelse.
