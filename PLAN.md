# Plan for GW2 Overlay

Fasene er ordnet etter nytte per innsats. Hver fase er selvstendig og kan brukes når den er ferdig. API-nøkkelen bør ha alle tillatelser, det er lagt til grunn.

## Fase 1: UI-finpuss (ferdig 11. sept)

- Dra-stripe øverst på panelet som alltid kan brukes til å flytte, uansett størrelse. Gjort.
- Faner viser bare ikon når panelet er smalt. Gjort.
- Tynne, mørke scrollbars i stedet for Windows-standard. Gjort.
- Inventory-tabellen skjuler kolonner trinnvis (1000, 850, 700, 600 px) så det aldri blir horisontal scroll. Gjort.
- Ctrl+Shift+G viser eller skjuler panelet. Gjort.
- Waypoint-klikk limer lenken rett inn i chatten i spillet. Gjort.
- Gjenstår: klikk-gjennom på hjulet når det er låst, og at panelet ikke stjeler tastatur fra spillet når du klikker i det.

## Fase 2: Samlinger og skins i inventory-rådgiveren (ferdig 11. sept)

Mål: rådgiveren skal vite hvorfor et item er verdt å beholde i stedet for å gjette. Gjort: skinn via `account/skins`, samlinger via achievement-indeks med Item-, Skin- og Minipet-bits, farger, oppskrifter og minis via `account/dyes`, `recipes`, `minis`. Fakta går til AI-en. Gjenstår: outfits og glidere har ingen id i item-API-et og kan ikke sjekkes.

- Hent `account/skins` og sammenlign med `default_skin` på hvert item. Ulåst skin gir "Behold, lås opp skinnet" eller "Bruk skinnet, så selg".
- Hent alle achievements én gang (`/v2/achievements`, cache på disk) og bygg indeks item-id til achievement. Hent `account/achievements` og sjekk bits. Item som mangler i en samling gir "Behold, mangler i samling X".
- Hent `account/recipes` og `account/dyes` for oppskrifter og farger du allerede har, så "Bruk"-anbefalingen blir "Selg, du har den allerede".
- Send disse funnene til AI-en som fakta, så den slipper å gjette.

Tillatelser: progression, unlocks.

## Fase 3: Trading Post-modul

- Egne kjøp og salg som ligger ute (`commerce/transactions/current`), med hvor langt fra markedspris de er og forslag om reprising.
- Historikk (`commerce/transactions/history`) med fortjeneste per item siste 7 og 30 dager.
- Varsel på hjulet når det ligger gull eller items og venter i `commerce/delivery`.
- Inventory-rådgiveren tar hensyn til at du allerede har et salg ute på itemet.

Tillatelser: tradingpost.

## Fase 4: DPS mot ekte logger

- Verifiser parseren mot ekte ArcDPS-logger og sammenlign med dps.report for samme logg.
- Boss-oversikt: bruk arcdps sin mappe-struktur og trigger-id for navn, vis også ikke-boss-mål ("cleave").
- Healing og barrier fra Healing Stats-addon (statechange 255-events).
- Boons: uptime på might, quickness, alacrity per spiller.
- Historikk: samme boss over tid, så du ser om du blir bedre.
- Auto-opplasting til dps.report med permalink, valgfritt.
- Live-tall under kamp er ikke mulig uten å lese spillets minne. Utredes kun hvis ArcDPS får en offisiell bro.

## Fase 5: Daglig og ukentlig

- Wizard's Vault daglig og ukentlig med hva som gjenstår (`account/wizardsvault/daily`, `weekly`, `special`).
- World bosses du allerede har drept i dag (`account/worldbosses`) merkes i tidsplanen, så du ser hvilke som fortsatt gir loot.
- Map chests og daglig crafting (`account/mapchests`, `account/dailycrafting`) som en sjekkliste.
- Fraktaler: nivå og daglige fra achievements-kategorien.
- Alt samlet i én modul "I dag" med sjekkbokser som fylles automatisk.

Tillatelser: progression.

## Fase 6: Karakterer og builds

- Oversikt per karakter: level, profesjon, utstyr med rarity og stat-kombinasjon, tomme slots, manglende infusions eller runer.
- Sammenlign utstyr med DPS-loggene: AI-en får build og resultat og kan foreslå hva som trekker ned.
- Crafting-nivå per karakter, så inventory-rådgiveren vet hvem som kan bruke hvilke materialer.

Tillatelser: builds, characters.

## Fase 7: Guild

- MOTD og siste guild-logg (hvem donerte, hvem ble med).
- Guild-lager (stash og treasury) med hva som mangler til pågående oppgraderinger.
- Inventory-rådgiveren kan foreslå "doner til guild" for materialer treasury trenger.

Tillatelser: guilds, og at kontoen har leder- eller tilgangsrettigheter i guilden.

## Fase 8: Overlay-forbedringer

- Klikk-gjennom for hjulet når det er låst, så det ikke stjeler klikk fra spillet.
- Auto-skjul når spillet ikke har fokus (fra MumbleLink `gameFocus`).
- Start med Windows og minimering til systemstatusfeltet.
- Pakking til installer med electron-builder, så det ikke trenger Node.
- Egen modul-mappe for tredjeparts-moduler, lastet ved oppstart.

## Status 11. september 2026

Alle fasene har en første versjon. Gjort:

- **Fase 3** Trading Post-modul: salg ute med underbudt-varsel, kjøpsordrer med overbudt-varsel, historikk med netto, leveringsboks, solgt og kjøpt siste 7 og 30 dager. Inventory-rådgiveren merker items du allerede har ute for salg.
- **Fase 4** DPS: boon-uptime (quickness, alacrity, fury) per spiller, opplasting til dps.report på knapp. Ikke gjort: healing (krever Healing Stats-addon), verifisering mot ekte logger (ingen logger på maskinen ennå), boss-historikk over tid.
- **Fase 5** "I dag"-modul: Wizard's Vault daglig, ukentlig og spesial, world bosses drept i dag med neste spawn og waypoint, daglige fraktaler, daglig crafting, Hero's Choice-kister, nedtelling til daglig og ukentlig reset. Tidsplanen merker bosses som er drept i dag.
- **Fase 6** Karakterer: utstyr per karakter med stat-kombinasjon, runer, sigiller og infusions, automatiske funn (tomme slots, manglende oppgraderinger, under Exotic, tomme infusion-slots), crafting-nivåer, AI-vurdering som også bruker siste ArcDPS-logg med karakteren.
- **Fase 7** Guild: MOTD, logg, lager og treasury med hva som mangler til oppgraderinger. Krever guilds-tillatelse og at rangen har innsyn.
- **Fase 8** Overlay: klikk-gjennom på hjulets gjennomsiktige områder, auto-skjul ved alt-tab (av som standard), start med Windows, ikon i systemstatusfeltet, «vis bare når spillet kjører» (følger Gw2-64.exe), valg av hvilke moduler som vises på hjulet, ArcDPS-installasjon og -oppdatering fra DPS-modulen med spillmappe-valg, førstegangs-oppsett som åpner Innstillinger, NSIS-installer via electron-builder. Ikke gjort: tredjeparts-modulmappe, eget app-ikon for installeren.

## Fase 9: Live (12. sept 2026, første versjon)

- ArcDPS-bro i Rust (`bridge/`): videresender kamphendelser over UDP. Installeres fra Live-modulen til `<GW2>\addons\arcdps\`. Pakkes med installeren.
- Live-tilstand i appen (`src/live.js`): buffs på deg med stacks og gjenværende tid, conditions og buffs på målet, cooldowns fra aktiveringer, i kamp/utenfor kamp.
- Overlay-vinduer (`src/overlays.js`, `renderer/overlay.*`): buffs, conditions, target, skill-bar. Flyttbare, strekkbare, låsbare med klikk-gjennom. Tall, skyggeklokke eller begge.
- Skill-bar (`src/modules/skills.js`): skills for karakteren du spiller fra API-et, inkludert elite-spec sin profesjonsmekanikk, cooldown fra API (25 % kortere med alacrity), rotasjon per karakter og spec med AI-forslag.
- Listevisning for buff-vinduene med navn, stacks, sekunder og nedtellingsskygge, sortering etter tid, stacks eller navn.
- Alle build-faner fra API-et, våpensett A og B fra utstyret, våpenbytte fra broen (statechange 11). Rotasjon og hold-oppe lagres per build og våpenkombinasjon og byttes automatisk. Hold-oppe: skill + boon, skillet blinker når boonen mangler og skillet er klart, forslag fra API-ets boon-fakta per skill.
- Ikke gjort: ikoner for boons og conditions (vises som forkortelser eller navn), attunement-bytte for Elementalist (viser Fire), våpenbytte til sett B, anbefalte builds fra nettsider (MetaBattle/Snow Crows har ingen stabil API; vurderes som eget steg), verifisering mot ekte kamp (broen er bare testet med syntetiske hendelser).

Ikke verifisert mot ekte konto: I dag, Trading Post, Karakterer og Guild er testet syntaktisk og mot API-dokumentasjonen, ikke mot kontoen din, siden API-nøkkelen ikke ligger i konfigfila på disk. Første kjøring kan avdekke feil i feltnavn.
