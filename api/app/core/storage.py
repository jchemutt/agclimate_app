"""Read-only access to published pipeline output, local folder or S3.

Layout (written by agclimate-prep `publish`), relative to the store root:

    <country>/latest.json
    <country>/runs.json
    <country>/boundaries/<level>.geojson
    <country>/<init>/catalog.json
    <country>/<init>/layers/<id>.tif | <id>.json
    <country>/<init>/areas/<level>.json
    <country>/<init>/data/{layers,members,ensemble_indices}.nc

Run folders are cached (memory and disk) until the run is republished: each time
an index file is re-read (every `index_ttl` seconds) the run's `created` stamp is
compared with the one recorded on disk, and a changed run is dropped from the
cache. A preview replaced by the full run for the same date is picked up this way.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path, PurePosixPath

from .config import API_V1, Settings

INDEX_FILES = {"latest.json", "runs.json"}


class NotFound(Exception):
    pass


def _clean(key: str) -> str:
    p = PurePosixPath(key)
    if p.is_absolute() or ".." in p.parts or not key:
        raise NotFound(key)
    return str(p)


class Store:
    def __init__(self, settings: Settings):
        self.s = settings
        self._lock = threading.Lock()
        self._json: dict[str, tuple[float, object]] = {}
        self._versions: dict[str, str] = {}          # "<country>/<init>" -> created stamp
        if settings.data_dir:
            self.kind, self.root = "local", Path(settings.data_dir)
        elif settings.s3_bucket:
            import boto3
            self.kind = "s3"
            self.root = settings.cache_dir / "s3"
            self._s3 = boto3.client("s3", region_name=settings.aws_region or None)
        else:
            raise RuntimeError("Set DATA_DIR (local folder) or S3_BUCKET")

    # ------------------------------------------------------------------ files
    def path(self, key: str) -> Path:
        """Local path of `key` (downloaded and cached first when on S3)."""
        key = _clean(key)
        if self.kind == "local":
            p = self.root / key
            if not p.is_file():
                raise NotFound(key)
            return p
        p = self.root / key
        fresh = p.is_file() and (PurePosixPath(key).name not in INDEX_FILES
                                 or time.time() - p.stat().st_mtime < self.s.index_ttl)
        if fresh:
            return p
        from botocore.exceptions import ClientError
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + f".{os.getpid()}.{threading.get_ident()}.part")
        s3key = f"{self.s.s3_prefix}/{key}" if self.s.s3_prefix else key
        try:
            self._s3.download_file(self.s.s3_bucket, s3key, str(tmp))
        except ClientError as e:
            tmp.unlink(missing_ok=True)
            if p.is_file():          # keep serving the stale index if S3 is unreachable
                return p
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "403", "AccessDenied"):
                raise NotFound(key) from e
            raise
        tmp.replace(p)
        return p

    def exists(self, key: str) -> bool:
        try:
            self.path(key)
            return True
        except NotFound:
            return False

    def json(self, key: str):
        key = _clean(key)
        ttl = self.s.index_ttl if PurePosixPath(key).name in INDEX_FILES else float("inf")
        with self._lock:
            hit = self._json.get(key)
            if hit and time.time() - hit[0] < ttl:
                return hit[1]
        data = json.loads(self.path(key).read_text())
        with self._lock:
            self._json[key] = (time.time(), data)
        if PurePosixPath(key).name in INDEX_FILES:
            self._track_versions(key, data)
        return data

    # ------------------------------------------------------------------ republished runs
    def _track_versions(self, key: str, data) -> None:
        country = PurePosixPath(key).parts[0]
        stamps = {}
        if isinstance(data, dict) and "runs" in data:
            stamps = {r["init"]: r.get("created") for r in data["runs"] if r.get("init")}
        elif isinstance(data, dict) and data.get("init"):
            stamps = {data["init"]: data.get("updated")}
        for init, stamp in stamps.items():
            if stamp:
                self._check_run(f"{country}/{init}", str(stamp))

    def _check_run(self, run: str, stamp: str) -> None:
        with self._lock:
            if self._versions.get(run) == stamp:
                return
            marker = (self.root / run / ".version") if self.kind == "s3" else None
            seen = self._versions.get(run) or (marker.read_text().strip() if marker and marker.is_file() else None)
            if seen is not None and seen != stamp:
                for k in [k for k in self._json if k.startswith(run + "/")]:
                    del self._json[k]
                if marker is not None:
                    shutil.rmtree(self.root / run, ignore_errors=True)
            self._versions[run] = stamp
            if marker is not None:
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.write_text(stamp)

    def run_version(self, country: str, init: str) -> str | None:
        return self._versions.get(f"{country}/{init}")

    def public_url(self, key: str) -> str:
        """URL the browser uses for a layer file."""
        key = _clean(key)
        if self.s.public_data_url:
            return f"{self.s.public_data_url}/{key}"
        return f"{API_V1}/files/{key}"
