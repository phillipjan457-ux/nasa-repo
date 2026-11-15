# FIREWATCH PH backend (pipeline + API)

Harmonizes MODIS and VIIRS active-fire detections into a weekly "burning activity" index and serves it through an API.
The API output is an **index of detected burning activity** (MODIS-equivalent burning cell-days), not a count of fires or burned area.

## Workspace guide

This repository also contains Indonesia archive ingestion, comparison APIs, and two frontends. The Philippines demo instructions below describe the original pipeline; use the linked Indonesia documentation for that workflow.

| Location | Purpose |
| --- | --- |
| `api/` | FastAPI routes and application entry point |
| `firewatch/` | Data processing, analysis, and database access |
| `scripts/` | Data inspection, cleaning, and database-building commands |
| `frontend/command-center/` | Command Center web app; see its [setup instructions](frontend/command-center/README.md) for the required sibling archive service |
| `frontend/prototype/` | Small Indonesia comparison preview served at `/prototype`; see [API instructions](docs/indonesia_api.md) |
| `tests/` | All Python tests and shared pytest fixtures |
| `docs/` | Schemas, setup guides, and milestone notes |
| `data/` | Local archives, processing outputs, and databases; excluded from Git |

For Indonesia, start with the [database guide](docs/indonesia_database.md), [comparison API guide](docs/indonesia_api.md), and [cleaned data schema](docs/data_schema.md). Milestone notes in `docs/member2_progress.md` and `docs/prototype.md` record earlier stages and may describe older integration details.

Keep original downloads intact. Although the current builder reads archive JSON files under `data/processed/`, retain their existing locations to preserve file references. Use `data/raw/` for new original downloads and explicit input paths when needed. Keep synthetic/demo data clearly labelled.

## 1. Setup (Windows PowerShell)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
If activation is blocked: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then retry.

## 2. Build the database (demo data, about 10 seconds)

```powershell
python -m firewatch.pipeline
```
Creates `data/firewatch.db`. The data is **synthetic** and labelled `DEMO DATA` in every API response.

## 3. Run the API

```powershell
uvicorn api.main:app --reload
```
Open http://127.0.0.1:8000/docs (interactive docs for the frontend team).

## 4. Run the tests

```powershell
pytest
```

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/health` | status and data label |
| `GET /api/aois` | preset areas with bbox |
| `GET /api/aois/{id}/geometry` | GeoJSON feature |
| `GET /api/aois/{id}/weekly?from=&to=&series=` | year x week values (`harmonized`, `modis`, `viirs`, `viirs_cal`) with percentile, z-score, anomaly flag |
| `GET /api/aois/{id}/climatology` | median and percentile bands per week |
| `GET /api/aois/{id}/anomalies?z=2` | flagged weeks and top 5 unusual years |
| `GET /api/aois/{id}/critical-periods?threshold=90` | merged critical periods (75, 80 or 90) |
| `GET /api/aois/{id}/calibration` | beta, R2, RMSE, bias and an annual before/after series |
| `GET /api/aois/{id}/summary` | data for the summary cards |
| `GET /api/aois/{id}/week-detail?year=&week=` | burning cells for the map drill-down |
| `GET /api/aois/{id}/export.csv` | weekly series download |
| `POST /api/aoi/weekly` | same analysis for a user-drawn GeoJSON polygon |

Preset ids: `PH`, `MINDANAO`, `BUKIDNON`, `VALENCIA`, `CENTRAL_LUZON`, `NEGROS`.

## Using real NASA FIRMS data

1. Download MODIS and VIIRS (Suomi-NPP) archive CSVs for the Philippines from NASA FIRMS (check the current download route and any login requirement).
2. Put all CSVs under `data/raw/` (any subfolders).
3. Run `python -m firewatch.pipeline --firms-dir data/raw`.

Expected columns: `latitude, longitude, acq_date`, plus `instrument` and/or `satellite`, `confidence`, `frp`, and `type` if available. Missing optional columns are handled. The data label becomes `NASA FIRMS`.

## How it works (pipeline steps)

1. Clip to the Philippines box, normalize sensors, quality filter (MODIS confidence below 30 dropped, VIIRS low dropped, FIRMS types volcano/static/offshore dropped).
2. Core VIIRS series = Suomi-NPP only (constant overpass count). NOAA-20/21 are ignored when S-NPP exists.
3. Snap detections to a 0.01 degree grid (about 1 km). Cell IDs are stable.
4. Flag static heat sources (near a listed volcano, or detected in 8+ years and 9+ months). They are excluded from the default series.
5. One flag per cell, UTC day and sensor, then sum to burning cell-days per week (`week = floor((day_of_year - 1) / 7) + 1`, max 52).
6. Weeks outside a sensor's data range are NULL, not zero.
7. Calibrate per AOI: `MODIS = beta x VIIRS` through the origin on 2013 to 2022.
8. Harmonized series: MODIS before 2013, average of MODIS and `beta x VIIRS` for 2013 to 2021, `beta x VIIRS` from 2022. Years before 2003 are flagged low confidence.
9. Climatology (median and percentiles per week over 2003 to 2022), robust z-score and percentile per week, critical periods from the top weeks of the climatology.

All thresholds and rules are in `firewatch/config.py`.

## Credits and attribution

- Fire detections: NASA FIRMS MODIS and VIIRS archives, where used.
- Basemap: Esri World Gray Canvas; map attribution includes Esri, HERE, Garmin,
  and OpenStreetMap contributors. Keep the on-map attribution visible.
- Mapping library: [Leaflet](https://leafletjs.com/).

Credit data providers and software separately, and add attribution for any
additional datasets used by a workflow.

## Known limitations and TODO

- Preset AOIs are **approximate boxes**. Replace with official boundaries (check license) in `firewatch/config.py`.
- Volcano list and the Philippines bounding box need verification.
- One global calibration season (`all`). Per-season or per-month fits are a possible improvement.
- Baseline years include the year being scored.
- Drawn polygons reuse the national (`PH`) calibration factor.
- Terra and Aqua orbit drift, clouds, smoke and canopy affect detections. A week with no detections is not proof of no fire.
