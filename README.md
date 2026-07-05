# Drone Flight Logbook

A free, open-source flight logbook for drone pilots — built with UK CAA requirements in mind.

**Live app:** https://mars-fpv.github.io/drone-logbook/ (installable as an app, works offline)

## What it does

- **CAA-aware logging** — fields for Flyer ID, Operator ID, airspace class, operation category (Open A1–A3, Specific PDRA01 / UK SORA, BVLOS) and pre-flight check confirmation.
- **RPC-L2 hour tracking** — running total of logged hours with a live "hours remaining to 50" counter.
- **Currency warnings** — flags when you have less than 2 hours logged in the last 3 months (minimum currency for Specific Category ops).
- **EdgeTX telemetry auto-import** — point it at the CSV logs on your radio's SD card (`/LOGS` folder) and it creates entries automatically: date, takeoff/landing times, duration, max altitude, GPS coordinates and battery capacity used. Daily logs are split into individual flights, and re-importing never duplicates.
- **Betaflight blackbox import** — decode `.bbl` / `.bfl` logs to CSV with the included script, then import them the same way: duration, max altitude, minimum voltage and GPS position are extracted per arm/disarm session. Blackbox logs carry no calendar date, so those entries are flagged until you set one.
- **Your data stays yours** — everything is stored locally on your device (IndexedDB). No server, no account, no tracking.
- **Backups** — one-tap export of all entries to a JSON file, and restore that merges without duplicating.
- **Installable PWA** — add it to your phone's home screen or install from a desktop browser; it works fully offline at the field.

## Running locally

Requires [Node.js](https://nodejs.org/) 20+.

```sh
git clone https://github.com/Mars-FPV/drone-logbook.git
cd drone-logbook
npm install
npm run dev
```

Production build: `npm run build` (output in `dist/`).

## Importing flights from your radio

1. Take the SD card out of your EdgeTX radio (or connect it in USB storage mode).
2. Find the telemetry logs in the `/LOGS` folder — one CSV per model per day, e.g. `Red Scorp-2026-03-28.csv`.
3. In the app, open the **Data** tab → **Import from Radio** and select one or more CSV files.
4. Review the imported entries and fill in location names, mission types and anything else telemetry can't know.

Telemetry logging must be enabled in your model's Special Functions for logs to exist.

## Importing Betaflight blackbox logs

Blackbox logs need decoding to CSV first (a browser can't read the raw format):

1. Copy your `.bbl` / `.bfl` files into a `blackbox-logs/` folder in the project.
2. Run `npm run decode-blackbox`. On first run it downloads `blackbox_decode`
   from the blackbox-tools v0.4.3 GitHub release (the upstream
   cleanflight/blackbox-tools project — Betaflight's fork is source-only and
   publishes no binaries). Windows only; on other platforms build it from
   source and drop it in `tools/`.
3. Each arm/disarm session becomes its own CSV (`.01.csv`, `.02.csv`, …).
   Sub-20-second arm blips and GPS-only fragments are skipped at import.
4. Import the CSVs via the app's **Data** tab — the same button handles EdgeTX
   and blackbox files.
5. Blackbox logs don't record the calendar date: imported entries show a
   **date needed** flag — open each one and set the date.

## Reporting bugs

Found a problem? [Open an issue](https://github.com/Mars-FPV/drone-logbook/issues) and include:

- What you did and what you expected to happen
- Browser and OS (e.g. Chrome on Android 15)
- For import problems: the first few lines of the CSV file (remove GPS coordinates if you don't want to share your location)

## Roadmap

- INAV blackbox log import (INAV uses its own decoder fork)
- In-browser blackbox decoding (no Node script step)
- Per-aircraft statistics and battery cycle tracking
- Monthly hours chart
- CSV export for sharing with clients or the CAA
- Maintenance log per airframe
- Optional encrypted sync between devices

Contributions welcome — open an issue to discuss before starting anything big.

## Disclaimer

This is a community tool, not an official CAA product. It helps you keep records, but you are responsible for complying with the regulations that apply to your flying. Always check the current [CAA guidance](https://www.caa.co.uk/drones/).

## License

[MIT](LICENSE)
