# Field Notes

Brand-neutral, offline-first field book PWA for survey crews. Company-specific JSA labels, hospital list, codebook, tolerances, watermark and file-name pattern, and export mapping come from a swappable **company profile**. Settings → Company Profile can import and export that JSON.

**Live app:** https://poquejr.github.io/survey-field-notes-app/

Factory default: `presets/generic-default.json` (set in `config.json`). Optional bundled profile: `presets/nv5-sandiego.json`.

## What’s in this build

- Daily field book, level notes, safety / JSA, daily field report, and manhole dips
- Control CSV import (column mapping is remembered) and KMZ / KML for Google Earth
- Field tools: units, inverse, traverse / COGO, curves, level-loop closure, area, grid ↔ ground (you enter the combined scale factor), CA State Plane ↔ lat/lon, and an OPUS text / XML reader
- **Finish Day:** one tap builds a `JobNo_YYYYMMDD_Crew.zip` folder with the day’s PDFs, CSVs, photos, OPUS summaries, and `Job.kmz`. Each part can be turned off; items that have data are on by default

The app also works from a `file://` copy for crews without a server (the service worker is not registered in that mode). For install and GPS, serve it over HTTPS.

## Install on a device

Open the live app over HTTPS, then:

- **Android Chrome:** menu → Add to Home Screen / Install app.
- **iOS:** open in **Safari** (not Chrome) → Share → Add to Home Screen.

## Run locally

This folder is the site root (`index.html` at the top level). The service worker does not run from `file://`, so serve it over http:

```bash
python3 -m http.server 8780
# open http://127.0.0.1:8780/
```

On a phone on the same network, use `http://<lan-ip>:8780/`.

## Company profiles

- Default profile: `config.json` → `defaultProfile` (`generic-default`).
- Bundled: `presets/generic-default.json` (neutral) and `presets/nv5-sandiego.json`.
- Switch, import, or export in the app under Settings → Company Profile.
- Add another company by dropping `presets/<id>.json` and listing it in `presets/index.json`. The core UI stays generic (“Field Notes”).
