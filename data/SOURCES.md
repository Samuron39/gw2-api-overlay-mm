# Kilder til tidsplan og waypoint-oppslag

Tidsplandataene kommer fra Guild Wars 2-wikien og beholdes under prosjektets eksisterende CC BY-SA-attribusjon. «Nå» betyr et aktivt tidsplansegment; det fastslår ikke at bossen lever i spillerens kartinstans.

Kontrollert 17. september 2026:

- Ni manglende waypoint-ID-er (2643, 2667, 2676, 2723, 2747, 2753, 2797, 2947, 2963) er supplert med navn, kart, kart-ID og koordinater fra [ArenaNets offisielle Crystal Desert-data på gulv 49](https://api.guildwars2.com/v2/continents/1/floors/49/regions/12). Gulv 1 mangler disse kartdataene selv om `/v2/maps` oppgir `default_floor: 1`.
- [ArenaNets verdensbossliste](https://api.guildwars2.com/v2/worldbosses) bekrefter `drakkar`. Wikisegmentet «Drakkar and Spirits of the Wild» kobles til denne ID-en i den delte tidsberegningen.
- Det medfølgende wiki-datasettet legger Dragon's Stand-starten til 23:30 UTC og deretter hvert andre time. Det innledende `(continued)`-segmentet er knyttet til samme hendelse som segmentet før midnatt. Dette er en konsistensretting i eksisterende data, ikke en ny verifisering av spillserverens klokke.

`test/timers.test.js` kontrollerer alle waypoint-lenker i hele tidsplandatasettet, ikke bare kjerneverdensbossene.

Iron Ore er kontrollert mot [ArenaNets item 19699](https://api.guildwars2.com/v2/items/19699) og [wikiens Iron Ore-side](https://wiki.guildwars2.com/wiki/Iron_Ore). At regelmotoren bruker jern i både T2- og T3-estimatet er tilsiktet: jern brukes også til stål, og materialet kan komme fra salvaging av utstyr på nivå 19–53. Tabellen beholdes som et grovt verdiestimat, ikke en eksakt sannsynlighetsmodell.

Guider bruker egne navngitte waypoint/chat-koder fra `guides.json`. Manglende treff i koordinatindeksen fjerner derfor ikke den kopierbare koden. Oppføringer uten waypoint viser den eksisterende «ingen waypoint»-teksten og wikilenken; testene angir disse oppføringene eksplisitt. Koordinatindeksen er komplett for tidsplanen, ikke for hele spillverdenen.

`bosses.json` (18. september 2026): art-id-er (species id) for raid-, strike- og fractal-bosser, Soo-Won og treningsgolemene, kuratert fra enum `TargetID` i [GW2 Elite Insights Parser, `SpeciesIDs.cs`](https://github.com/baaron4/GW2-Elite-Insights-Parser/blob/master/GW2EI.Library/GW2EI.Services/GW2EIEvtcParser/ParserHelpers/IDs/SpeciesIDs.cs) (MIT-lisens). Bare selve bossene er tatt med, ikke adds, og gadget-bosser er utelatt fordi gadgets har flyktig id i sanntid. Navnene er skrevet ut for lesbarhet; id-ene er uendret fra kilden. Nye bosser legges til ved å slå opp id-en i samme fil.
