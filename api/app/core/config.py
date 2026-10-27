"""Runtime settings, all from environment variables (see deploy/.env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


API_V1 = "/api/v1"


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@dataclass(frozen=True)
class Settings:
    # Where published pipeline output lives. One of:
    #   DATA_DIR=/data/published            (local folder: <country>/runs.json, ...)
    #   S3_BUCKET=... [S3_PREFIX=published]  (s3://bucket/published/<country>/...)
    data_dir: str = field(default_factory=lambda: _env("DATA_DIR"))
    s3_bucket: str = field(default_factory=lambda: _env("S3_BUCKET"))
    s3_prefix: str = field(default_factory=lambda: _env("S3_PREFIX", "published").strip("/"))
    aws_region: str = field(default_factory=lambda: _env("AWS_REGION") or _env("AWS_DEFAULT_REGION"))
    # Public base URL for layer files (e.g. a CloudFront distribution in front of
    # s3://bucket/published). Empty = the API serves the files itself (/api/files/...).
    public_data_url: str = field(default_factory=lambda: _env("PUBLIC_DATA_URL").rstrip("/"))
    profiles_dir: Path = field(default_factory=lambda: Path(_env("PROFILES_DIR", "profiles")))
    cache_dir: Path = field(default_factory=lambda: Path(_env("CACHE_DIR", "/tmp/agclimate-cache")))
    # Seconds before a cached index file (latest.json, runs.json) is re-read.
    index_ttl: int = field(default_factory=lambda: int(_env("INDEX_TTL", "300")))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(o for o in _env("CORS_ORIGINS").split(",") if o))


@lru_cache
def get_settings() -> Settings:
    return Settings()
