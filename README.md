# GW2 Overlay

A modular overlay for Guild Wars 2 on Windows. A small wheel sits over the game and opens modules in a panel: a live DPS meter, buffs and conditions on you and your target, a skill bar with cooldowns and rotation, world boss and meta timers with waypoints pasted straight into chat, short boss strategies from the wiki, Wizard's Vault and daily progress, Trading Post, characters, guild, and an inventory advisor powered by AI.

Everything runs on your machine. The only external calls are to the official GW2 API, the GW2 wiki (for guides), dps.report if you press "Upload" yourself, and an AI provider only if you choose a cloud one instead of a local model.

Norsk? Les [README.nb.md](README.nb.md), den fullstendige dokumentasjonen på norsk. The app itself is in English or Norwegian, chosen from your Windows language on first start and changeable in Settings.

## Screenshots

The UI is shown in Norwegian here; the app is in English on an English Windows.

![The wheel, buffs on you and the DPS meter during a world boss fight](docs/screenshots/combat-dps.jpg)

<table>
<tr><td width="50%" valign="top"><img src="docs/screenshots/dps-all.png" alt="DPS meter, view "All": damage, damage taken and healing for the last fight"><br><sub>DPS meter, view "All": damage, damage taken and healing for the last fight</sub></td><td width="50%" valign="top"><img src="docs/screenshots/dps-taken.png" alt="View "Taken": who hit you, per source"><br><sub>View "Taken": who hit you, per source</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/screenshots/dps-healing.png" alt="View "Healing": HPS and healing per skill"><br><sub>View "Healing": HPS and healing per skill</sub></td><td width="50%" valign="top"><img src="docs/screenshots/overlays-unlocked.png" alt="Unlocked overlay windows are dragged and resized in place"><br><sub>Unlocked overlay windows are dragged and resized in place</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/screenshots/live-tab.png" alt="Live tab: bridge status and one card per overlay window"><br><sub>Live tab: bridge status and one card per overlay window</sub></td><td width="50%" valign="top"><img src="docs/screenshots/timers.png" alt="Timers: current and next event per map, waypoint pasted into chat"><br><sub>Timers: current and next event per map, waypoint pasted into chat</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/screenshots/today.png" alt="Today: Wizard's Vault, world bosses killed today, daily fractals"><br><sub>Today: Wizard's Vault, world bosses killed today, daily fractals</sub></td><td width="50%" valign="top"><img src="docs/screenshots/today-worldbosses.png" alt="Today, world bosses: one click pastes name, time and waypoint"><br><sub>Today, world bosses: one click pastes name, time and waypoint</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/screenshots/characters.png" alt="Characters: gear per character with stats, runes and infusions"><br><sub>Characters: gear per character with stats, runes and infusions</sub></td><td width="50%" valign="top"><img src="docs/screenshots/get-started.png" alt="Get started: every step checked, buttons fix what is missing"><br><sub>Get started: every step checked, buttons fix what is missing</sub></td></tr>
<tr><td width="50%" valign="top"><img src="docs/screenshots/settings-update.png" alt="Settings: update card at the top, API key, AI provider"><br><sub>Settings: update card at the top, API key, AI provider</sub></td><td width="50%" valign="top"><img src="docs/screenshots/settings-overlay.png" alt="Settings: modules on the wheel, scaling, start with Windows"><br><sub>Settings: modules on the wheel, scaling, start with Windows</sub></td></tr>
</table>

## Install

1. Download `GW2 Overlay Setup <version>.exe` from the [latest release](https://github.com/Samuron39/gw2-api-overlay-mm/releases/latest).
2. Windows SmartScreen will say "Windows protected your PC" because the installer is not code-signed (a certificate costs money, the project is free). Click **More info**, then **Run anyway**.
3. Start the app. The panel opens on the **Get started** tab, which checks everything below and has buttons to fix what is missing.

The app updates itself: it checks GitHub Releases at startup, every 6 hours and each time the game starts, downloads in the background, and shows a notification from the system tray when a new version is ready. Your settings and API key live in `%APPDATA%\gw2-inventory-overlay` and are never touched by updates.

## Getting started

- **API key.** Create one at <https://account.arena.net/applications> with all permissions (account, inventories, characters, wallet, unlocks, progression, tradingpost, builds, guilds) and paste it under Settings. It never leaves your machine.
- **ArcDPS and the bridge.** Live data (DPS meter, buffs, target, skill bar) needs [ArcDPS](https://www.deltaconnected.com/arcdps/) plus our own small ArcDPS extension, the bridge. The wizard installs both: ArcDPS is downloaded from the author's official site and MD5-verified (it cannot be bundled, the author does not allow redistribution), and the bridge (`arcdps_gw2overlay_bridge.dll`, open source in `bridge/`) is copied into the game folder next to `d3d11.dll`. The game must be closed while installing.
- **AI (optional).** The inventory advisor, character review and the guides use an AI model. Default is [LM Studio](https://lmstudio.ai) running locally on port 1234, so nothing leaves your PC. No GPU for that? Pick a cloud provider under Settings → AI: Google Gemini has a free tier that is enough for this app; OpenAI, Anthropic, DeepSeek, xAI and any OpenAI-compatible endpoint (Ollama, OpenRouter, Groq…) also work. Keys are stored locally and are never included in error reports.
- **Start with Windows** and **Show the overlay only while the game is running** together make the overlay appear when `Gw2-64.exe` starts and disappear when it exits. **Hide when neither the game nor the overlay has focus** hides everything on alt-tab.

## Modules

| Module | What it does |
|---|---|
| **Live** | Overlay windows: buffs on you, conditions on you, buffs and conditions on your target, a skill bar with cooldowns, charges, the next skill in your rotation and "keep up" alerts, up to three DPS meter windows, and a small "next world bosses" window with countdowns where a click pastes the boss name, time left, map and waypoint into chat. Each window has its own position, size, opacity and lock. |
| **DPS meter** | Like a WoW meter, in real time from the bridge: DPS now and average, total, target, top skills, squad ranking, damage taken per source with a death log ("Killed by X, last hits…"), healing done and received. Per window you pick the view (all, damage, squad, taken, healing) and the period (this fight, last fight, whole session). Works on open-world mobs too, not just bosses. |
| **DPS** | Post-fight analysis of ArcDPS `.evtc`/`.zevtc` logs: damage per skill, boon uptime, and optional upload to dps.report. |
| **Timers** | World bosses and meta events with countdowns. One click pastes "Shadow Behemoth in 11 min (22:39) · Queensdale · [&BPcAAAA=]" into the game chat. |
| **Today** | Wizard's Vault daily and weekly, world bosses already killed today, daily fractals, crafting and map chests, all ticked off automatically from the API. |
| **Guides** | Short strategies for world bosses, fractals, raids, strikes and dungeons, summarised by AI from the GW2 wiki (CC BY-SA, link shown), with 2–4 lines short enough to paste into chat, plus location and waypoint code for every entry. The map you are standing on is listed first. |
| **Inventory** | Advisor for every item in bags and bank: keep, sell, salvage, vendor, deposit. A rule engine knows about collections, unlocked skins, dyes, recipes and minis; the AI explains the rest. |
| **Trading Post** | Your current buys and sells versus market price, history with profit, and gold or items waiting for delivery. |
| **Characters** | Gear per character with rarity and stats, empty slots, missing infusions or runes, and an AI review. |
| **Guild** | Guild info, stash, treasury, upgrades and the guild log. |
| **Settings** | Update card at the top, language, AI provider, modules on the wheel, overlay behaviour, error report with one click. |

## Is this allowed?

The overlay reads nothing from the game's memory. It uses three official interfaces: the [GW2 API](https://wiki.guildwars2.com/wiki/API:Main), [MumbleLink](https://wiki.guildwars2.com/wiki/API:MumbleLink) (position, map, focus) and the ArcDPS extension API, which is how every ArcDPS addon works. It does not automate anything in the game. Pasting a waypoint into chat happens only when you click a button, and only the paste itself is sent as keystrokes.

## Privacy

- API key, AI keys, positions and settings stay in `%APPDATA%\gw2-inventory-overlay\config.json`.
- With the default local AI, no game data leaves your PC. With a cloud provider, the item list or wiki text for a guide is sent to that provider.
- The error report (Settings → Troubleshooting → Copy error report) contains versions, settings without keys, live status and the last 200 log lines. Paste it into an issue when something breaks.

## Antivirus

The bridge is a DLL that ArcDPS loads into the game process, like every other ArcDPS extension. Some antivirus products flag that pattern. The source is in `bridge/` (Rust) and the DLL is built from it for each release.

## Building from source

```bash
npm ci
npm start
```

Use Node 22.18.x and Rust for development. Electron is pinned to the validated version, 44.3.0. `npm run build:native` builds the helper and bridge with Cargo.lock and records source/binary hashes; packaging always rebuilds and checks both. `npm run dist:installer` builds the installer.

`npm test` runs 232 tests (17 September 2026), including mocked Electron/IPC, renderer lifecycle, network failures and real EVTC workers. `npm run check` checks JavaScript syntax. Windows CI runs both and builds the native parts. `node scripts/smoke-electron.js` and `node scripts/smoke-electron.js --packaged` run separate, temporary demo profiles and exit automatically. They never start the game helper, live UDP listener or updater.

The stabilization changes and remaining in-game checks are recorded in [the validation report](docs/VALIDERING-2026-09-17.md). Corrupt configuration is preserved before recovery; unavailable unlock data remains unknown; AI requests can be cancelled; log parsing runs in workers.

Working on the code, or pointing an AI agent at it? Read [AGENTS.md](AGENTS.md) first: setup, rules, the release procedure and everything learned about ArcDPS the hard way.

## Credits and licence

MIT, see [LICENSE](LICENSE). Guild Wars 2 and all game assets are © ArenaNet / NCSOFT. Boon and condition icons and the timer and guide data come from the [GW2 wiki](https://wiki.guildwars2.com) (CC BY-SA 3.0). ArcDPS is by deltaconnected. Healing from other squad members uses the [arcdps healing stats](https://github.com/Krappa322/arcdps_healing_stats) extension when installed.
