# Default map snapshot

The frontend bundles a small, versioned snapshot of January 2022 vegetation
observations for Indonesia, day and night, with no region filter. It contains
clustered harmonized/MODIS/VIIRS maps at zoom 4 and 5 plus the matching summary.
It contains no raw observations or database credentials.

The initial map and summary display this saved data while API requests run in
the background. A prepared-date notice remains until live data replaces it.
Failed refreshes retain the saved map. Different filters and zoom levels use
the normal viewport API and existing bounded navigation cache. Cached live
viewports take priority over the prepared snapshot. Obsolete requests cannot
replace a newer selection.

## Regenerate after updating the archive or processing code

Run from the repository root, using the actual processed archive path:

```powershell
.\.venv\Scripts\python.exe -B -m scripts.export_map_snapshot --db ../firewatch-command-center-preview/backend/data/firewatch.sqlite
```

This reads SQLite without modifying it and updates
`frontend/command-center/src/data/default-map.json`. The content-derived version
changes when the exported data changes; the generation timestamp is separate.
Commit the generated JSON with the frontend source, then redeploy the frontend.
The frontend build needs neither Python nor database access. Vite gives the
snapshot chunk a content-hashed filename for browser caching and deployment updates.

The browser does not write to this shared file. For future live data, publish new
snapshots through a trusted server/build process; keep the prepared timestamp
visible whenever the live refresh is unavailable. The snapshot improves first
paint, but cannot prevent Render from sleeping or guarantee live API latency.
