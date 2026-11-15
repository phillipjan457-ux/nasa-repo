"""Snapshot export checks use a clearly synthetic archive in a temporary directory."""
from contextlib import closing
import hashlib
import json
import os
import sqlite3

import pytest
from backend.ingest import SCHEMA
from scripts.export_map_snapshot import export_snapshot


def test_export_is_versioned_read_only_and_contains_no_raw_observations(tmp_path, monkeypatch):
    source = tmp_path / "synthetic.sqlite"
    with closing(sqlite3.connect(source)) as connection:
        connection.executescript(SCHEMA)
        connection.execute("INSERT INTO metadata VALUES ('processed_at','synthetic-fixture')")
        connection.commit()
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    monkeypatch.setenv("FIREWATCH_ARCHIVE_DB", "original-setting")
    output = tmp_path / "snapshot.json"
    result = export_snapshot(source, output)
    assert json.loads(output.read_text())["version"] == result["version"]
    assert result["schema_version"] == 1
    assert len(result["maps"]) == 6
    assert result["dashboard"]["observations"] == []
    assert all(m["total"] == 0 and m["clusters"] == [] for m in result["maps"].values())
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    assert os.environ["FIREWATCH_ARCHIVE_DB"] == "original-setting"
    assert export_snapshot(source, output)["version"] == result["version"]


def test_missing_archive_does_not_create_a_database_or_snapshot(tmp_path):
    missing = tmp_path / "missing.sqlite"
    output = tmp_path / "snapshot.json"
    with pytest.raises(ValueError, match="Archive not found"):
        export_snapshot(missing, output)
    assert not missing.exists()
    assert not output.exists()


def test_output_cannot_overwrite_source_archive(tmp_path):
    source = tmp_path / "archive.sqlite"
    source.write_bytes(b"preserved source")
    with pytest.raises(ValueError, match="must not overwrite"):
        export_snapshot(source, source)
    assert source.read_bytes() == b"preserved source"
