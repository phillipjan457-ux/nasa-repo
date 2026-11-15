"""Export a small real-archive starting view; run from the repository root with -m."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3


def export_snapshot(db: Path, output: Path) -> dict:
    db = db.resolve()
    if not db.is_file():
        raise ValueError(f"Archive not found: {db}")
    if output.resolve() == db:
        raise ValueError("Snapshot output must not overwrite the source archive")
    previous = os.environ.get("FIREWATCH_ARCHIVE_DB")
    os.environ["FIREWATCH_ARCHIVE_DB"] = str(db)
    try:
        from backend.api import dashboard, map_data, anomalies
        anomalies.cache_clear()
        with closing(sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)) as connection:
            processed = connection.execute(
                "SELECT value FROM metadata WHERE key='processed_at'"
            ).fetchone()
        scope = dict(year=2022, month=1, region=None, daynight=None,
                     start_date=None, end_date=None, detection_type="vegetation")
        maps = {}
        for view in ("harmonized", "modis", "viirs"):
            for zoom in (4, 5):
                maps[f"{view}:{zoom}"] = map_data(
                    **scope, view=view, zoom=zoom, west=-180, east=180, south=-90, north=90
                )
        summary = dashboard(**scope, sensor=None, limit=0, offset=0)
        payload = dict(schema_version=1, scope=scope, maps=maps, dashboard=summary,
                       archive_processed_at=processed[0] if processed else None)
        payload["version"] = hashlib.sha256(
            json.dumps(payload, sort_keys=True, allow_nan=False).encode()
        ).hexdigest()[:16]
        payload["generated_at"] = datetime.now(timezone.utc).isoformat()
        encoded = json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(encoded, encoding="utf-8")
        print(f"Snapshot {payload['version']}: {len(encoded.encode()):,} bytes; no raw observations")
        return payload
    finally:
        if previous is None:
            os.environ.pop("FIREWATCH_ARCHIVE_DB", None)
        else:
            os.environ["FIREWATCH_ARCHIVE_DB"] = previous


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] /
                        "frontend/command-center/src/data/default-map.json")
    args = parser.parse_args()
    export_snapshot(args.db, args.output)


if __name__ == "__main__":
    main()
