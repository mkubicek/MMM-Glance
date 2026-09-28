# Changelog

## 1.0.0 — first public release

- Rotating card deck: Sky, Lake (Zürichsee), Coming up (Sonarr/Radarr) and optional Wine of the day.
- Sky: local NOAA sun and Meeus moon calculations, EU clock change, canton-of-Zurich holidays.
- Default `location` is Zurich city centre, with a `label` that gives the "Sky over Zurich" title.
- New `skyTitle` option; the lake title falls back to the station name when `lake.title` is not set.
- Sonarr, Radarr and grapy settings can live in `~/.config/MMM-Glance/secrets.json` instead of `config.js`.
- Demo with synthetic data (`npm run demo`), screenshots, tests for the helper and Node 10 compatibility.
