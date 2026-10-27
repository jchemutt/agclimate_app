"""Read-only access to published pipeline output, local folder or S3.

Layout (written by agclimate-prep `publish`), relative to the store root:

    <country>/latest.json
    <country>/runs.json
    <country>/boundaries/<level>.geojson
    <country>/<init>/catalog.json
    <country>/<init>/layers/<id>.tif | <id>.json
    <country>/<init>/areas/<level>.json
    <country>/<init>/data/{layers,members,ensemble_indices}.nc

Run folders never change once published, so they are cached on disk forever;
the two index files are re-read after `index_ttl` seconds.
"""
from __future__ import annotations

import json
import os
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
        return data

    def public_url(self, key: str) -> str:
        """URL the browser uses for a layer file."""
        key = _clean(key)
        if self.s.public_data_url:
            return f"{self.s.public_data_url}/{key}"
        return f"{API_V1}/files/{key}"
