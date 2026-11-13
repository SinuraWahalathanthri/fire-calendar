# Fire Calendar: harmonized MODIS + VIIRS burning-activity calendar

A web application for the NASA Space Apps challenge *Harmonization of MODIS and VIIRS Hot Spots*.
It merges more than 25 years of NASA FIRMS active-fire hotspots into one sensor-neutral time series.
On top of that series it builds a **burning-activity calendar** with anomalies, trends, critical
periods, a nowcast/outlook, alerts and downloadable reports. **Sri Lanka** is the default view
(25 districts, 9 provinces, protected areas), and the same analysis works for any country,
drawn polygon, bounding box or point-plus-radius on Earth.

Built for early-warning and emergency responders, firefighters, land managers and scientists.

## Quick start

Requires Node.js 18 or later.

```bash
npm run build        # one time: installs and builds the React frontend (web/)
npm start            # API + app on http://localhost:8080
```

The server itself has no npm dependencies. Only the frontend in `web/` is built with npm.

### Developing the frontend

```bash
npm start            # terminal 1: API on :8080
npm run dev:web      # terminal 2: React app with hot reload on http://localhost:5173 (proxies /api to :8080)
npm run typecheck    # TypeScript check of the frontend
npm test             # server tests
```

Without a key the app runs on **clearly labelled synthetic demo data**, which exercises the full
pipeline offline. For live NASA data, get a free MAP_KEY at
<https://firms.modaps.eosdis.nasa.gov/api/map_key/> and:

```bash
cp .env.example .env     # set FIRMS_MAP_KEY=...
npm start
```

In live mode, the server:
1. backfills history for Sri Lanka from the FIRMS API. It uses MODIS_SP / VIIRS_SNPP_SP /
   VIIRS_NOAA20_SP, then the matching NRT sources after the SP archive ends, fetching the most
   recent data first in 5-day chunks (the API maximum) and caching everything on disk. A
   country-sized request costs about 10 of the key's 5,000 transactions per 10 minutes, so the
   server watches the key's live usage and pauses near the limit. A full 2000→today backfill of
   Sri Lanka (about 3,800 requests) takes roughly 75–90 minutes the first time; restarts reuse the cache;
2. polls the near-real-time feeds every `POLL_MINUTES` (default 15), pushes new detections to
   browsers over Server-Sent Events, and evaluates alert rules;
3. creates and backfills a dataset on demand the first time anyone analyses a new region.
   Regions larger than ~4.5 M km² get recent NRT only; import the FIRMS archive for those (below).

### Docker

```bash
docker build -t fire-calendar .
docker run -d -p 8080:8080 -e FIRMS_MAP_KEY=xxxx -v fire-data:/app/data fire-calendar
```

### Large regions or full history from the FIRMS archive

Download CSVs from <https://firms.modaps.eosdis.nasa.gov/download/> (choose a country, all years), then:

```bash
node scripts/import-archive.js --source MODIS_SP        fire_archive_M-C61_*.csv
node scripts/import-archive.js --source VIIRS_SNPP_SP   fire_archive_SV-C2_*.csv
node scripts/import-archive.js --source VIIRS_NOAA20_SP fire_archive_J1V-C2_*.csv
```

You can also send the CSV to the running server with `POST /api/v1/import?source=MODIS_SP`.

## Harmonization method

Raw counts can't be compared across sensors. MODIS pixels are 1 km and VIIRS pixels are 375 m,
VIIRS detects smaller and cooler fires, one fire lights several VIIRS pixels, and the constellation
keeps changing: Terra alone until 2002, then Aqua, S-NPP in 2012, NOAA-20 in 2018 and NOAA-21 in 2024.
The app harmonizes each area of interest in five steps (`server/harmonize.js`):

1. **Quality filter.** Drop low-confidence detections (MODIS < 30 %, VIIRS `l`) and the
   volcano/static-industrial/offshore `type` codes.
2. **Common grid.** Snap detections to 0.01° cells (about 1.1 km) and count **unique fire
   cell-days**, which removes the pixel-size and duplicate bias.
3. **Constant constellation.** The reference satellite is chosen **day by day** from FIRMS's own
   data-availability dates: S-NPP, else NOAA-20 × k₂₀, else NOAA-21 × k₂₁, else MODIS × k.
   This keeps the series continuous when a feed stops; S-NPP's NRT feed, for example, ends on
   2026-11-02. MODIS = Terra + Aqua; Terra-only days are scaled by the Terra+Aqua / Terra ratio
   measured over 2003–2011.
4. **Cross-calibration.** Estimate k = VIIRS / MODIS cell-days for each calendar month over the
   overlap window (2012-02 → 2021-12, before Terra's orbit drift). Each k is shrunk toward the
   annual ratio, and toward a prior when local data are sparse.
5. **Merge.** VIIRS-era months use VIIRS directly; MODIS-era months use k × MODIS. Every original
   detection gets a `harmonized_weight`, so summing the CSV by month reproduces the calendar.

Diagnostics (k by month, log-log r², calibration error) are shown per area on the **Method** and
**Explore → Sensors** pages.

### Accuracy safeguards

| Problem | What the app does |
|---|---|
| Factories, refineries, power plants and gas flares show up as "fires" every week (NRT data has no type flag) | Cells with heat on ≥ 10 days/yr in ≥ 6 calendar months, plus cells FIRMS tags as static, are excluded from every figure and alert. They appear on the map as dark squares. In Sri Lanka this removes what appear to be the Puttalam cement plant and the Sapugaskanda refinery. |
| A satellite feed stops; S-NPP NRT, for example, ends on 2026-11-02 | The reference satellite is chosen per day from FIRMS's availability dates, with NOAA-20 / NOAA-21 cross-calibrated against S-NPP. |
| In-sample calibration hides real error | Ratios are fitted on 2012–2016 and scored on 2017–2021 (monthly error, annual error, bias). The score appears on the Method page, and MODIS-era calendar cells show their typical error. |
| Small areas have too little overlap to calibrate | They borrow the regional ratio measured from the surrounding dataset. In Sri Lanka, VIIRS sees about 7× as many fire cell-days as MODIS, because the fires are small agricultural burns. |
| "Normal" based on years not yet downloaded | While history loads, missing years count as missing, not as zero-fire years, and the baseline shown is the one actually used. |
| Outlook overfits | The persistence weight and the El Niño term are kept only if they lower the error on a rolling 1-month-ahead hindcast. |

`npm test` runs the core checks: ratio recovery, no jump across the 2012 sensor switch,
weights summing to the calendar, NOAA-20 takeover, industrial-site detection, area shapes, and
an outlook that does no worse than climatology.

## Analytics

- **Burning calendar** (years × months) on accessible ramps: single-hue Ember or Blue,
  Cividis for colour-vision deficiency, and Grayscale for print. It has count and anomaly modes,
  quantile classes and numbers in the cells, and the month in progress is marked.
- **Anomalies** against a selectable multi-year baseline: % vs mean, z-score and percentile.
- **Critical periods and fire season**: the shortest run of months holding ≥ 70 % of activity.
- **Trend**: Theil–Sen slope with a Mann–Kendall significance test; year-to-date vs median.
- **Nowcast**: month-to-date scaled by the typical intra-month profile, giving the projected
  month-end, its percentile and a status level (Low → Extreme, always shown with an icon and a label).
- **Outlook (prediction)**: 6 months ahead, built from the climatological median, adjusted for
  recent-anomaly persistence and for ENSO when that helps, with a capped trend. The weights are
  chosen and scored by a rolling hindcast. It uses fire history and ENSO only, with no weather
  forecast.
- **Sri Lanka district watch**: 7-day detections, month vs median, peak month and density for
  all 25 districts. In a quiet week the table ranks districts by normal-year burning, for
  preparedness.
- **Parks & reserves** (35 areas from OpenStreetMap): burning in the last 7 and 30 days, the usual
  level, the managing agency (Department of Wildlife Conservation or Forest Department), a map
  overlay, and a "hotspot inside a protected area" alert rule.
- **Any country**: province and state breakdowns from geoBoundaries, fetched on first use.
- **El Niño / La Niña**: NOAA's monthly ONI, the area's historical response to each phase, and
  inclusion in the outlook only when it helps.

## Integration (government departments)

| Need | Endpoint |
|---|---|
| Latest hotspots | `GET /api/v1/live?district=Monaragala&hours=24&format=geojson` |
| Everything for an area | `GET /api/v1/analyze?country=Sri%20Lanka` |
| Calendar CSV | `GET /api/v1/calendar?province=Uva&format=csv` |
| Harmonized hotspot export | `GET /api/v1/hotspots?bbox=80,7,81,8&start=2024-01-01&end=2024-12-31&format=csv` |
| Outlook | `GET /api/v1/outlook?lat=8.45&lon=80.0&radius_km=25` |
| District table | `GET /api/v1/districts?format=csv` |
| World ranking | `GET /api/v1/global?hours=24` |
| Alert rules | `GET/POST /api/v1/alerts`, `DELETE /api/v1/alerts/{id}` (Bearer token if `API_TOKENS` set) |
| Alert feeds | `/api/v1/feeds/alerts.cap.xml` (CAP 1.2), `.geojson`, `.rss` |
| Live push | `GET /api/stream` (Server-Sent Events: `hotspots`, `alert`, `global`) |
| Embed | `<iframe src="/#/embed?district=Badulla">` (the old `/embed.html?…` address redirects here) |

Area parameters: `country`, `district`, `province`, `bbox=w,s,e,n`, `lat`/`lon`/`radius_km`, or
POST a GeoJSON polygon. Optional: `baseline=2003-2022`, `start`, `end`.

Webhooks: each alert rule can POST a JSON alert to a URL. Restrict who can create rules with `API_TOKENS`.

## Project layout

```
server/  index.js (HTTP + API) · firms.js (FIRMS client) · harmonize.js · analytics.js
         store.js (datasets, backfill, polling) · alerts.js (rules, CAP/RSS/GeoJSON) · geo.js · demo.js
         static.js (industrial sources) · climate.js (ENSO) · boundaries.js (regions for any country)
web/     React 18 + TypeScript + Vite frontend
         src/api/        types.ts (every field the UI uses) · client.ts (fetch helpers, exports)
         src/state/      AppState.tsx (selected area, toasts, live stream, TanStack Query hooks)
         src/components/ Calendar · charts (SeasonChart, ChartBox) · MapView (basemaps, layers) · DrawControl
                         BackfillBanner · RegionTable · AreaPicker · Layout · ui (RiskBadge, Card, …)
         src/pages/      Dashboard · Explore · World · Outlook · Reports · Method · Integrate · Embed
         src/lib/        format.ts · colors.ts (ramps, CVD-checked series colours) · leaflet.ts
public/data/  countries-50m.json (Natural Earth) · lka-districts.geojson (geoBoundaries) · lka-protected.geojson (OSM)
scripts/ import-archive.js
tests/   core.test.js (npm test)
```

## Data and attribution

NASA FIRMS (LANCE / Earthdata): MODIS Collection 6.1 and VIIRS 375 m active fire products.
Boundaries: Natural Earth (public domain) and geoBoundaries / OpenStreetMap (ODbL).
Basemaps: Esri World Light Gray, Esri World Imagery, OpenStreetMap. ENSO: NOAA CPC Oceanic Niño Index.
Protected areas: OpenStreetMap (ODbL). Some gazetted areas are not mapped yet. Hotspots are thermal anomalies and include non-wildfire burning;
check them on the ground before acting.
