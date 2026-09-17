# Kilder til tidsplan og waypoint-oppslag

Tidsplandataene kommer fra Guild Wars 2-wikien og beholdes under prosjektets eksisterende CC BY-SA-attribusjon. «Nå» betyr et aktivt tidsplansegment; det fastslår ikke at bossen lever i spillerens kartinstans.

Kontrollert 17. september 2026:

- Ni manglende waypoint-ID-er (2643, 2667, 2676, 2723, 2747, 2753, 2797, 2947, 2963) er supplert med navn, kart, kart-ID og koordinater fra [ArenaNets offisielle Crystal Desert-data på gulv 49](https://api.guildwars2.com/v2/continents/1/floors/49/regions/12). Gulv 1 mangler disse kartdataene selv om `/v2/maps` oppgir `default_floor: 1`.
- [ArenaNets verdensbossliste](https://api.guildwars2.com/v2/worldbosses) bekrefter `drakkar`. Wikisegmentet «Drakkar and Spirits of the Wild» kobles til denne ID-en i den delte tidsberegningen.
- Det medfølgende wiki-datasettet legger Dragon's Stand-starten til 23:30 UTC og deretter hvert andre time. Det innledende `(continued)`-segmentet er knyttet til samme hendelse som segmentet før midnatt. Dette er en konsistensretting i eksisterende data, ikke en ny verifisering av spillserverens klokke.

`test/timers.test.js` kontrollerer alle waypoint-lenker i hele tidsplandatasettet, ikke bare kjerneverdensbossene.
