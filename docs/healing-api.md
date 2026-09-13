# Healing i DPS-måleren: hva ArcDPS og «arcdps healing stats» faktisk tilbyr

Undersøkt 13. september 2026 mot ArcDPS-dokumentasjonen i `C:\Apper\gw2-wt\docs\` (API-README og evtc-README,
build 20260816) og kildekoden i GitHub-repoet [Krappa322/arcdps_healing_stats](https://github.com/Krappa322/arcdps_healing_stats)
(master, hentet rått fra `raw.githubusercontent.com`). Sitatene under er fra disse filene.

## 1. ArcDPS selv har ingen healing-hendelse

Søk etter «heal» i `arcdps-evtc-README.txt` gir bare:

- `CBTS_COMBAT`: «value: combined shield+health strike damage», «buff_dmg: combined shield+health buff damage» (linje 38–39)
- `is_ninety: src is above 90% health`, `is_fifty: dst is below 50% health` (45–46)
- `CBTS_HEALTHPCTUPDATE, // agent health percentage changed` (95) og `CBTS_MAXHEALTHUPDATE` (121)
- `CBTS_RATEHEALTH, // retired, not used since 260627+` (305)
- `int16_t healing;` i `evtc_agent` (798): healing-POWER-statten til agenten, ikke hendelser

Altså: ingen egen hendelsestype for healing, og ingen overheal. `arcdps-api-README.txt` nevner ikke heal i det hele tatt.

**MEN:** healing er likevel synlig i `combat_local` («chatbox events»), fordi spillets kampvindu viser både skade og
healing. Healing-utvidelsen bygger nettopp på dette. Fra `src/Common.h` i healing stats, funksjonen `GetEventType`:

```cpp
if (pEvent->is_statechange != 0 || pEvent->is_activation != 0 || pEvent->is_buffremove != 0) return EventType::Other;
if (pEvent->buff == 0) {
    switch (pEvent->result) { case CBTR_STRIKE_DAMAGENORMAL: case CBTR_STRIKE_DAMAGECRIT: case CBTR_STRIKE_DAMAGEGLANCE: break;
                              case CBTR_SKILLCAST: return EventType::Other; default: return EventType::SemiDamaging; }
    if (pEvent->value == 0) return EventType::SemiDamaging;
    if ((pIsLocal && pEvent->value < 0) || (!pIsLocal && pEvent->value > 0)) return EventType::Damage;
    else return EventType::Healing;                       // Direct healing
} else {
    if (pEvent->buff_dmg == 0) return EventType::SemiDamaging;
    else if ((pIsLocal && pEvent->buff_dmg < 0) || (!pIsLocal && pEvent->buff_dmg > 0)) return EventType::Damage;
    else return EventType::Healing;                       // Buff healing (e.g. Regeneration)
}
```

Dvs. i den lokale kanalen er skade NEGATIV (som vi selv målte: `value -698`) og healing POSITIV: direkte healing i
`value` (`buff == 0`, `result` 0/1/2), regenerasjons-ticks i `buff_dmg` (`buff == 1`). Barrier: `is_shields != 0`
(`EventProcessor.cpp`, `LocalCombat`: `if (pEvent->is_shields != 0) mLocalState.BarrierGenerationEvent(...) else HealingEvent(...)`).
README-linja for `CBTS_COMBAT` sier «is_shields: damage was partially or wholly absorbed by barrier»; for healing-hendelser
betyr det altså «barrier generert».

**Bekreftet i vårt eget opptak** (`opptak-2026-09-13.log`, bare local-kanalen for treff): 12 hendelser med `"s":"local"`,
`sc 0`, `buff 0`, `value > 0`, `iff 0`, src = dst = spilleren selv: `Dolyak Signet` 490, `Bloodthirster` 1414/1376,
`Chant of Recuperation` (76863) 509–982, og `Chant of Recuperation` (76782) 1891/1945 med `overstack == value`
(barrier-delen; `is_shields` ble ikke sendt av broen før denne grenen). Opptaket var solo, så healing fra/til andre er
ikke observert.

Konsekvens: **egen healing gjort og healing mottatt trenger IKKE healing-utvidelsen.** Broen har allerede
`combat_local`, og den kanalen er sanntid (i motsetning til evtc-kanalen som er 2–3 s forsinket). Healing-utvidelsen
gjør det samme i `EventProcessor::LocalCombat`, den har ingen annen datakilde («This addon uses the local stats provided
by ArcDPS», README). Begrensningen er den samme som utvidelsens: «This information is only available for the local player,
i.e. the server does not notify about healing done by other players to other players.»

## 2. Grensesnittet healing stats tilbyr andre utvidelser

Repoet har ingen `docs/`-mappe og ingen eksportert C-header for et «addon API». `src/Exports.h` eksporterer bare de to
ArcDPS-påkrevde funksjonene (`get_init_addr`, `get_release_addr`) og holder `GlobalObjects` (interne pekere til `e3`, `e5`,
`e7`, `e9`, `e10`). Ingen delt minne, ingen callback-registrering, ingen ekstra eksporter i DLL-en.

Det som finnes er **evtc-loggingen via ArcDPS** (README: «Also logs healing to the arcdps evtc, allowing evtc parsers to show
healing stats»). Den bruker ArcDPS-eksportene beskrevet i `arcdps-api-README.txt`:

- `e9  adds ev to arc's event processing [ void e9(cbtevent* ev, uint32_t sig) ]`: «is_statechange will be set to
  CBTS_EXTENSION, pad61-64 will be set to sig. events will end up in the ringbuffer and sent along the realtime api»
- `e10 adds ev to arc's event processing (with skill processing)`: «is_statechange will be set to CBTS_EXTENSIONCOMBAT,
  pad61-64 will be set to sig. same as e9, however, skillid will be treated as skillid»
- evtc-README: `CBTS_EXTENSION, // for extension use. not managed by arcdps  // evtc: yes // realtime: yes` og
  `CBTS_EXTENSIONCOMBAT, // assumed to be cbtevent struct, skillid will be processed ... // evtc: yes // realtime: yes`

Siden hendelsene går inn i ArcDPS sin vanlige hendelsesbehandling, kommer de ut igjen i `combat`-callbacken (evtc/area-kanalen)
til ALLE lastede utvidelser. Healing stats leser faktisk sin egen versjonshendelse tilbake der
(`EventProcessor::AreaCombat`: `else if (pEvent->is_statechange == CBTS_EXTENSION) { memcpy(&pad, &pEvent->pad61, 4); ... }`).
Det er dette vår bro kan lytte på.

### Konstanter (`src/AddonVersion.h`)

```cpp
#define HEALING_STATS_ADDON_SIGNATURE 0x9c9b3c99U   // sig i arcdps_exports OG i pad61-64 på heal-hendelser (e10)
#define HEALING_STATS_EVTC_REVISION 2U
#define VERSION_EVENT_SIGNATURE 0x00000000U         // sig på versjonshendelsen (e9) som sendes ved CBTS_SQCOMBATSTART
struct EvtcVersionHeader { uint32_t Signature; uint32_t EvtcRevision : 24; uint32_t VersionStringLength : 8; };
enum HealingEventFlags : uint8_t {
    HealingEventFlags_TargetIsDowned           = 1 << 5,  // bare satt for buff-healing; for direkte healing: se lave bits i is_offcycle
    HealingEventFlags_EventCameFromDestination = 1 << 6,  // dst_agent/dst_instid er den som genererte hendelsen
    HealingEventFlags_EventCameFromSource      = 1 << 7,  // src_agent/src_instid er den som genererte hendelsen
};
```

### Feltene i en heal-hendelse (`EventProcessor.cpp`, `LocalCombat`, blokken `if (mEvtcLoggingEnabled)`)

Hendelsen er en kopi av den lokale `cbtevent`-en med disse endringene før `ARC_E10(&logEvent, HEALING_STATS_ADDON_SIGNATURE)`:

| felt | betydning |
|---|---|
| `is_statechange` | settes av ArcDPS til `CBTS_EXTENSIONCOMBAT` (ordinal 49 talt i evtc-README; `CBTS_EXTENSION` = 40) |
| `pad61..pad64` | `0x9c9b3c99` (little-endian u32) |
| `src_agent`, `dst_agent` | ArcDPS unike agent-id-er (kilde, mottaker) |
| `src_instid`, `dst_instid`, `*_master_instid` | som i ArcDPS (minion → master) |
| `value` | **negert**: heal-mengde som negativt tall («Flip event values so healed amount is negative») for direkte healing (`buff == 0`) |
| `buff_dmg` | **negert** heal-mengde for buff-healing (`buff == 1`, f.eks. Regeneration) |
| `skillid` | skill; ArcDPS legger navnet i skill-tabellen (e10) |
| `is_shields` | != 0: barrier generert, ikke helse |
| `is_offcycle` | flaggene over: bit 7 «fra kilden», bit 6 «fra mottakeren», bit 5 «målet var downed» (buff-healing) |
| `time`, `iff`, `result`, `buff` | uendret fra den lokale hendelsen |

Overheal finnes ikke: README «Planned features: Track overhealing. This is kind of hard because it would require simulating
healing events». Vi rapporterer alltid `over: 0`.

Samme logg-blokk finnes i `PeerCombat` (healing andre i squaden deler via «live stats sharing», gRPC mot
`evtc-rpc.kappa322.com`): der byttes `src_agent`/`dst_agent` til lokale unike id-er først. Disse hendelsene er
**eneste** vei til andres healing, og bare for spillere som selv har utvidelsen og har slått på deling.

### Krav hos brukeren

- ArcDPS (`d3d11.dll`) og `arcdps_healing_stats.dll` i samme mappe (README «Installation»). Ingen «unofficial extras»
  eller andre DLL-er; alt (gRPC, protobuf, imgui, spdlog) er statisk lenket.
- Innstillingen `EvtcLoggingEnabled` må være på. Standard er **på** (`src/Options.h`: `bool EvtcLoggingEnabled = true;`),
  lagres i `addons\arcdps\arcdps_healing_stats.json`.
- For andres healing: «enable live stats sharing» hos både dem og deg (`EvtcRpcEnabled`, standard av).
- Utvidelsen registrerer seg i ArcDPS med `out_name = "healing_stats"` og `sig = HEALING_STATS_ADDON_SIGNATURE`.

## 3. Beslutning for broen og overlayen

1. **Primærkilde: `combat_local` direkte** (sanntid, ingen ekstra utvidelse). Broen klassifiserer hendelser med
   `GetEventType`-reglene over og sender dem som egen linjetype `heal` med `"ch":"local"`. Dekker egen healing gjort
   (inkl. minions via `src_master_instid`) og healing mottatt (dst = deg). Barrier fra `is_shields`.
2. **Sekundærkilde: healing stats sine `CBTS_EXTENSIONCOMBAT`-hendelser** i `combat`-kanalen, gjenkjent på
   `pad61-64 == 0x9c9b3c99`, sendt som `heal` med `"ch":"ext"` og verdiene negert tilbake til positive. `live.js` bruker
   dem BARE for healing gjort av andre (squad-liste); egne hendelser der er duplikater av local-kanalen (2–3 s forsinket)
   og ignoreres.
3. **Deteksjon:** broen sjekker `GetModuleHandleW(L"arcdps_healing_stats.dll")` ved hver hello og setter `"healExt":1`
   når utvidelsen er lastet i spillprosessen (eller når en ext-hendelse med signaturen er sett). `"heal":1` i hello betyr
   at broen støtter heal-linjer.
4. Overheal: alltid 0 (finnes ikke i noen kilde).

## Kilder

- `C:\Apper\gw2-wt\docs\arcdps-api-README.txt` (e9/e10, `arcdps_exports`, `combat`/`combat_local`)
- `C:\Apper\gw2-wt\docs\arcdps-evtc-README.txt` (`cbtevent`, `CBTS_EXTENSION`, `CBTS_EXTENSIONCOMBAT`, `is_shields`)
- `C:\Apper\gw2-wt\docs\opptak-2026-09-13.log` (heal-hendelser i local-kanalen)
- https://github.com/Krappa322/arcdps_healing_stats/blob/master/README.md
- https://github.com/Krappa322/arcdps_healing_stats/blob/master/src/Common.h (`GetEventType`)
- https://github.com/Krappa322/arcdps_healing_stats/blob/master/src/EventProcessor.cpp (`LocalCombat`, `PeerCombat`, `AreaCombat`)
- https://github.com/Krappa322/arcdps_healing_stats/blob/master/src/AddonVersion.h (signatur, flagg)
- https://github.com/Krappa322/arcdps_healing_stats/blob/master/src/Exports.h (ingen ekstra eksporter)
- https://github.com/Krappa322/arcdps_healing_stats/blob/master/src/Options.h (`EvtcLoggingEnabled = true`)
- https://github.com/Krappa322/arcdps_healing_stats/blob/master/src/dllmain.cpp (`e9`/`e10` via `GetProcAddress`, `out_name = "healing_stats"`)
